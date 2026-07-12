#![cfg(test)]

use cosmwasm_std::{to_json_binary, Empty, Uint128};
use cw20::{Cw20Coin, Cw20ExecuteMsg};
use cw_multi_test::{App, Contract, ContractWrapper, Executor};

use crate::{execute as mock_usdc_execute, instantiate as mock_usdc_instantiate, query as mock_usdc_query};
use crate::Cw20Coin as MockCw20Coin;
use crate::InstantiateMsg as MockUsdcInstantiateMsg;
use kickoff_market::msg::{BetMsg, ExecuteMsg, InstantiateMsg as MarketInstantiateMsg, Outcome, QueryMsg, Side};

fn market_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        kickoff_market::contract::execute,
        kickoff_market::contract::instantiate,
        kickoff_market::contract::query,
    ))
}

fn cw20_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        cw20_base::contract::execute,
        cw20_base::contract::instantiate,
        cw20_base::contract::query,
    ))
}

fn mock_usdc_contract() -> Box<dyn Contract<Empty>> {
    Box::new(ContractWrapper::new(
        mock_usdc_execute,
        mock_usdc_instantiate,
        mock_usdc_query,
    ))
}

/// mock-usdc (CW20) drives a real Kickoff market via the CW20 Send → Receive hook.
#[test]
fn mock_usdc_send_triggers_market_bet() {
    let mut app = App::default();
    let owner = app.api().addr_make("owner");
    let resolver = app.api().addr_make("resolver");
    let alice = app.api().addr_make("alice");
    let bob = app.api().addr_make("bob");

    let usdc_id = app.store_code(cw20_contract());
    let market_id = app.store_code(market_contract());

    let usdc = app
        .instantiate_contract(
            usdc_id,
            owner.clone(),
            &cw20_base::msg::InstantiateMsg {
                name: "USDC".to_string(),
                symbol: "USDC".to_string(),
                decimals: 6,
                initial_balances: vec![
                    Cw20Coin { address: alice.to_string(), amount: Uint128::new(1_000_000) },
                    Cw20Coin { address: bob.to_string(), amount: Uint128::new(1_000_000) },
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
            owner.clone(),
            &MarketInstantiateMsg {
                usdc: usdc.to_string(),
                resolver: resolver.to_string(),
                question: "Will the home team win?".to_string(),
                closes_at: 9_999_999_999,
            },
            &[],
            "market",
            None,
        )
        .unwrap();

    app.execute_contract(
        alice.clone(),
        usdc.clone(),
        &Cw20ExecuteMsg::Send {
            contract: market.to_string(),
            amount: Uint128::new(1000),
            msg: to_json_binary(&BetMsg { side: Side::Yes }).unwrap(),
        },
        &[],
    )
    .unwrap();

    let stake: kickoff_market::msg::StakeResp = app
        .wrap()
        .query_wasm_smart(
            market.clone(),
            &QueryMsg::Stake { user: alice.to_string(), side: Side::Yes },
        )
        .unwrap();
    assert_eq!(stake.amount, Uint128::new(1000));

    app.execute_contract(
        bob.clone(),
        usdc.clone(),
        &Cw20ExecuteMsg::Send {
            contract: market.to_string(),
            amount: Uint128::new(2000),
            msg: to_json_binary(&BetMsg { side: Side::No }).unwrap(),
        },
        &[],
    )
    .unwrap();

    app.update_block(|b| b.time = cosmwasm_std::Timestamp::from_seconds(9_999_999_999 + 1));
    app.execute_contract(
        resolver.clone(),
        market.clone(),
        &ExecuteMsg::Settle { outcome: Outcome::Yes },
        &[],
    )
    .unwrap();

    let state: kickoff_market::msg::StateResp = app
        .wrap()
        .query_wasm_smart(market.clone(), &QueryMsg::State {})
        .unwrap();
    assert_eq!(state.outcome, Some(Outcome::Yes));
    assert_eq!(state.total_yes, Uint128::new(1000));
    assert_eq!(state.total_no, Uint128::new(2000));
}

/// mock-usdc standalone: transfer + send hook with its own receiver.
#[test]
fn mock_usdc_transfer_and_send() {
    let mut app = App::default();
    let owner = app.api().addr_make("owner");
    let alice = app.api().addr_make("alice");
    let bob = app.api().addr_make("bob");

    let usdc_id = app.store_code(mock_usdc_contract());
    let usdc = app
        .instantiate_contract(
            usdc_id,
            owner.clone(),
            &MockUsdcInstantiateMsg {
                name: "Mock USDC".to_string(),
                symbol: "USDC".to_string(),
                decimals: 6,
                initial_balances: vec![
                    MockCw20Coin { address: alice.to_string(), amount: Uint128::new(1_000_000) },
                ],
            },
            &[],
            "mock-usdc",
            None,
        )
        .unwrap();

    app.execute_contract(
        alice.clone(),
        usdc.clone(),
        &crate::ExecuteMsg::Transfer { recipient: bob.to_string(), amount: Uint128::new(500) },
        &[],
    )
    .unwrap();

    let bal: crate::BalanceResp = app
        .wrap()
        .query_wasm_smart(&usdc, &crate::QueryMsg::Balance { address: bob.to_string() })
        .unwrap();
    assert_eq!(bal.balance, Uint128::new(500));
}
