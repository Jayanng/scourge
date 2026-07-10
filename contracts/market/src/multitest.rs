#![cfg(test)]

use cosmwasm_std::{Addr, Empty, Uint128};
use cw20::{BalanceResponse, Cw20Coin, Cw20ExecuteMsg, Cw20QueryMsg};
use cw_multi_test::{App, Contract, ContractWrapper, Executor};

use crate::msg::{
    BetMsg, ExecuteMsg, InstantiateMsg, Outcome, QueryMsg, Side, StakeResp, StateResp,
};

fn market_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        crate::contract::execute,
        crate::contract::instantiate,
        crate::contract::query,
    ))
}

fn cw20_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        cw20_base::contract::execute,
        cw20_base::contract::instantiate,
        cw20_base::contract::query,
    ))
}

struct TestEnv {
    app: App,
    usdc: Addr,
    market: Addr,
    resolver: Addr,
    alice: Addr,
    bob: Addr,
}

impl TestEnv {
    fn setup(closes_at: u64) -> Self {
        let mut app = App::default();
        let owner = app.api().addr_make("owner");
        let resolver = app.api().addr_make("resolver");
        let alice = app.api().addr_make("alice");
        let bob = app.api().addr_make("bob");

        let cw20_id = app.store_code(cw20_contract());
        let market_id = app.store_code(market_contract());

        let usdc = app
            .instantiate_contract(
                cw20_id,
                owner.clone(),
                &cw20_base::msg::InstantiateMsg {
                    name: "USD Coin".to_string(),
                    symbol: "USDC".to_string(),
                    decimals: 6,
                    initial_balances: vec![
                        Cw20Coin {
                            address: alice.to_string(),
                            amount: Uint128::new(1_000_000),
                        },
                        Cw20Coin {
                            address: bob.to_string(),
                            amount: Uint128::new(1_000_000),
                        },
                    ],
                    mint: None,
                    marketing: None,
                },
                &[],
                "usdc",
                None,
            )
            .unwrap();

        let market = app
            .instantiate_contract(
                market_id,
                owner,
                &InstantiateMsg {
                    usdc: usdc.to_string(),
                    resolver: resolver.to_string(),
                    question: "Will there be a corner between min 34-36?".to_string(),
                    closes_at,
                },
                &[],
                "market",
                None,
            )
            .unwrap();

        Self {
            app,
            usdc,
            market,
            resolver,
            alice,
            bob,
        }
    }

    fn bet(&mut self, who: &Addr, side: Side, amount: u128) -> Result<(), String> {
        let msg = cosmwasm_std::to_json_binary(&BetMsg { side }).map_err(|e| e.to_string())?;
        self.app
            .execute_contract(
                who.clone(),
                self.usdc.clone(),
                &Cw20ExecuteMsg::Send {
                    contract: self.market.to_string(),
                    amount: Uint128::new(amount),
                    msg,
                },
                &[],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn settle(&mut self, who: &Addr, outcome: Outcome) -> Result<(), String> {
        self.app
            .execute_contract(
                who.clone(),
                self.market.clone(),
                &ExecuteMsg::Settle { outcome },
                &[],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn claim(&mut self, who: &Addr) -> Result<(), String> {
        self.app
            .execute_contract(who.clone(), self.market.clone(), &ExecuteMsg::Claim {}, &[])
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn usdc_balance(&self, who: &Addr) -> Uint128 {
        let bal: BalanceResponse = self
            .app
            .wrap()
            .query_wasm_smart(
                self.usdc.clone(),
                &Cw20QueryMsg::Balance {
                    address: who.to_string(),
                },
            )
            .unwrap();
        bal.balance
    }

    fn state(&self) -> StateResp {
        self.app
            .wrap()
            .query_wasm_smart(self.market.clone(), &QueryMsg::State {})
            .unwrap()
    }

    fn stake(&self, user: &Addr, side: Side) -> Uint128 {
        let r: StakeResp = self
            .app
            .wrap()
            .query_wasm_smart(
                self.market.clone(),
                &QueryMsg::Stake {
                    user: user.to_string(),
                    side,
                },
            )
            .unwrap();
        r.amount
    }
}

/// Default closes far in the future relative to mock block time (~1.5e9).
const CLOSES_AT: u64 = 2_000_000_000;

#[test]
fn yes_wins_parimutuel_payout() {
    let mut env = TestEnv::setup(CLOSES_AT);

    // Alice 300 Yes, Bob 100 No → pool 400
    env.bet(&env.alice.clone(), Side::Yes, 300).unwrap();
    env.bet(&env.bob.clone(), Side::No, 100).unwrap();

    assert_eq!(env.stake(&env.alice, Side::Yes), Uint128::new(300));
    assert_eq!(env.state().total_yes, Uint128::new(300));
    assert_eq!(env.state().total_no, Uint128::new(100));

    env.settle(&env.resolver.clone(), Outcome::Yes).unwrap();

    // Alice payout = 300 * 400 / 300 = 400
    env.claim(&env.alice.clone()).unwrap();
    assert_eq!(
        env.usdc_balance(&env.alice),
        Uint128::new(1_000_000 - 300 + 400)
    );

    // Bob loses — claim must fail (NothingToClaim)
    assert!(env.claim(&env.bob.clone()).is_err());
    // Bob still down his stake
    assert_eq!(env.usdc_balance(&env.bob), Uint128::new(1_000_000 - 100));
}

#[test]
fn no_wins_parimutuel_payout() {
    let mut env = TestEnv::setup(CLOSES_AT);

    env.bet(&env.alice.clone(), Side::Yes, 200).unwrap();
    env.bet(&env.bob.clone(), Side::No, 200).unwrap();

    env.settle(&env.resolver.clone(), Outcome::No).unwrap();

    // Bob payout = 200 * 400 / 200 = 400
    env.claim(&env.bob.clone()).unwrap();
    assert_eq!(
        env.usdc_balance(&env.bob),
        Uint128::new(1_000_000 - 200 + 400)
    );
}

#[test]
fn void_refunds_both_sides() {
    let mut env = TestEnv::setup(CLOSES_AT);

    env.bet(&env.alice.clone(), Side::Yes, 150).unwrap();
    env.bet(&env.bob.clone(), Side::No, 250).unwrap();

    env.settle(&env.resolver.clone(), Outcome::Void).unwrap();

    env.claim(&env.alice.clone()).unwrap();
    env.claim(&env.bob.clone()).unwrap();

    assert_eq!(env.usdc_balance(&env.alice), Uint128::new(1_000_000));
    assert_eq!(env.usdc_balance(&env.bob), Uint128::new(1_000_000));
}

#[test]
fn non_resolver_cannot_settle() {
    let mut env = TestEnv::setup(CLOSES_AT);
    env.bet(&env.alice.clone(), Side::Yes, 100).unwrap();

    assert!(env.settle(&env.alice.clone(), Outcome::Yes).is_err());
    assert!(env.state().outcome.is_none());
}

#[test]
fn cannot_bet_after_close() {
    let mut env = TestEnv::setup(CLOSES_AT);

    env.app.update_block(|b| {
        b.time = cosmwasm_std::Timestamp::from_seconds(CLOSES_AT + 1);
        b.height += 1;
    });

    assert!(env.bet(&env.alice.clone(), Side::Yes, 50).is_err());
    assert_eq!(env.state().total_yes, Uint128::zero());
}

#[test]
fn cannot_double_settle() {
    let mut env = TestEnv::setup(CLOSES_AT);
    env.bet(&env.alice.clone(), Side::Yes, 100).unwrap();
    env.bet(&env.bob.clone(), Side::No, 100).unwrap();

    env.settle(&env.resolver.clone(), Outcome::Yes).unwrap();
    assert!(matches!(env.state().outcome, Some(Outcome::Yes)));

    assert!(env.settle(&env.resolver.clone(), Outcome::No).is_err());
    // Outcome unchanged
    assert!(matches!(env.state().outcome, Some(Outcome::Yes)));
}

#[test]
fn cannot_claim_before_settle() {
    let mut env = TestEnv::setup(CLOSES_AT);
    env.bet(&env.alice.clone(), Side::Yes, 100).unwrap();

    assert!(env.claim(&env.alice.clone()).is_err());
    assert_eq!(env.usdc_balance(&env.alice), Uint128::new(1_000_000 - 100));
}
