#![cfg(test)]

use cosmwasm_std::{Addr, Empty, Uint128};
use cw20::Cw20Coin;
use cw_multi_test::{App, Contract, ContractWrapper, Executor};

use crate::msg::{ExecuteMsg, InstantiateMsg, MarketsResp, QueryMsg};
use kickoff_market::msg::{
    BetMsg, ExecuteMsg as MarketExecuteMsg, Outcome, QueryMsg as MarketQueryMsg, Side, StateResp,
};

fn market_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        kickoff_market::contract::execute,
        kickoff_market::contract::instantiate,
        kickoff_market::contract::query,
    ))
}

fn factory_contract() -> Box<dyn Contract<Empty>> {
    Box::new(
        ContractWrapper::new(
            crate::contract::execute,
            crate::contract::instantiate,
            crate::contract::query,
        )
        .with_reply(crate::contract::reply),
    )
}

fn cw20_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        cw20_base::contract::execute,
        cw20_base::contract::instantiate,
        cw20_base::contract::query,
    ))
}

const CLOSES_AT: u64 = 2_000_000_000;

#[test]
fn create_market_via_instantiate2_and_settle() {
    let mut app = App::default();
    let owner = app.api().addr_make("owner");
    let resolver = app.api().addr_make("resolver");
    let alice = app.api().addr_make("alice");

    let cw20_id = app.store_code(cw20_contract());
    let market_code_id = app.store_code(market_contract());
    let factory_id = app.store_code(factory_contract());

    let usdc = app
        .instantiate_contract(
            cw20_id,
            owner.clone(),
            &cw20_base::msg::InstantiateMsg {
                name: "USD Coin".into(),
                symbol: "USDC".into(),
                decimals: 6,
                initial_balances: vec![Cw20Coin {
                    address: alice.to_string(),
                    amount: Uint128::new(500_000),
                }],
                mint: None,
                marketing: None,
            },
            &[],
            "usdc",
            None,
        )
        .unwrap();

    let factory = app
        .instantiate_contract(
            factory_id,
            owner.clone(),
            &InstantiateMsg {
                market_code_id,
                usdc: usdc.to_string(),
                resolver: resolver.to_string(),
            },
            &[],
            "factory",
            None,
        )
        .unwrap();

    let question = "First yellow card before minute 20?".to_string();

    app.execute_contract(
        owner,
        factory.clone(),
        &ExecuteMsg::CreateMarket {
            question: question.clone(),
            closes_at: CLOSES_AT,
        },
        &[],
    )
    .unwrap();

    let markets: MarketsResp = app
        .wrap()
        .query_wasm_smart(factory, &QueryMsg::Markets {})
        .unwrap();
    assert_eq!(markets.markets.len(), 1);
    let market = markets.markets[0].clone();

    let state: StateResp = app
        .wrap()
        .query_wasm_smart(market.clone(), &MarketQueryMsg::State {})
        .unwrap();
    assert_eq!(state.question, question);
    assert_eq!(state.closes_at, CLOSES_AT);
    assert!(state.outcome.is_none());

    app.execute_contract(
        alice.clone(),
        usdc,
        &cw20::Cw20ExecuteMsg::Send {
            contract: market.to_string(),
            amount: Uint128::new(1_000),
            msg: cosmwasm_std::to_json_binary(&BetMsg { side: Side::Yes }).unwrap(),
        },
        &[],
    )
    .unwrap();

    // Advance past the market's close time before settling (TooEarly guard).
    app.update_block(|b| {
        b.time = cosmwasm_std::Timestamp::from_seconds(CLOSES_AT + 1);
    });

    app.execute_contract(
        resolver,
        market.clone(),
        &MarketExecuteMsg::Settle {
            outcome: Outcome::Yes,
        },
        &[],
    )
    .unwrap();

    app.execute_contract(alice, market, &MarketExecuteMsg::Claim {}, &[])
        .unwrap();
}

#[test]
fn rejects_past_closes_at() {
    let mut app = App::default();
    let owner = app.api().addr_make("owner");
    let resolver = app.api().addr_make("resolver");

    let cw20_id = app.store_code(cw20_contract());
    let market_code_id = app.store_code(market_contract());
    let factory_id = app.store_code(factory_contract());

    let usdc = app
        .instantiate_contract(
            cw20_id,
            owner.clone(),
            &cw20_base::msg::InstantiateMsg {
                name: "USDC".into(),
                symbol: "USDC".into(),
                decimals: 6,
                initial_balances: vec![],
                mint: None,
                marketing: None,
            },
            &[],
            "usdc",
            None,
        )
        .unwrap();

    let factory = app
        .instantiate_contract(
            factory_id,
            owner.clone(),
            &InstantiateMsg {
                market_code_id,
                usdc: usdc.to_string(),
                resolver: resolver.to_string(),
            },
            &[],
            "factory",
            None,
        )
        .unwrap();

    let err = app
        .execute_contract(
            owner,
            factory,
            &ExecuteMsg::CreateMarket {
                question: "too late".into(),
                closes_at: 1,
            },
            &[],
        )
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("closes_at") || err.contains("InvalidClosesAt") || err.contains("future"),
        "unexpected: {err}"
    );
}
