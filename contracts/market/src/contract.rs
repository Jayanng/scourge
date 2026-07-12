//! Binary fixed-odds (parimutuel) market.
//! Bets via CW20 USDC Send → Receive. Resolver-only Settle. Claim pays winners.

#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;
use cosmwasm_std::{
    from_json, to_json_binary, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo, Response,
    StdResult, Uint128, WasmMsg,
};
use cw2::set_contract_version;
use cw20::{Cw20ExecuteMsg, Cw20ReceiveMsg};

use crate::error::ContractError;
use crate::msg::{BetMsg, ExecuteMsg, InstantiateMsg, Outcome, QueryMsg, Side, StakeResp, StateResp};
use crate::state::{Config, CONFIG, OUTCOME, STAKE_NO, STAKE_YES, TOTAL_NO, TOTAL_YES};

const CONTRACT_NAME: &str = "crates.io:kickoff-market";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let config = Config {
        usdc: deps.api.addr_validate(&msg.usdc)?,
        resolver: deps.api.addr_validate(&msg.resolver)?,
        question: msg.question.clone(),
        closes_at: msg.closes_at,
    };
    CONFIG.save(deps.storage, &config)?;
    OUTCOME.save(deps.storage, &None)?;
    TOTAL_YES.save(deps.storage, &Uint128::zero())?;
    TOTAL_NO.save(deps.storage, &Uint128::zero())?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("question", msg.question)
        .add_attribute("closes_at", config.closes_at.to_string()))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Receive(w) => exec_bet(deps, env, info, w),
        ExecuteMsg::Settle { outcome } => exec_settle(deps, env, info, outcome),
        ExecuteMsg::Claim {} => exec_claim(deps, env, info),
    }
}

/// 1. sender must be CW20 USDC
/// 2. parse side from hook msg
/// 3. require open market (time < closes_at, unresolved)
/// 4. credit stake + totals
/// 5. emit bet event
fn exec_bet(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    cw20_msg: Cw20ReceiveMsg,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    if info.sender != config.usdc {
        return Err(ContractError::Unauthorized {});
    }
    if cw20_msg.amount.is_zero() {
        return Err(ContractError::ZeroAmount {});
    }
    if env.block.time.seconds() >= config.closes_at {
        return Err(ContractError::MarketClosed {});
    }
    let existing = OUTCOME.load(deps.storage)?;
    if existing.is_some() {
        return Err(ContractError::AlreadySettled {});
    }

    let bet: BetMsg = from_json(&cw20_msg.msg)?;
    let better = deps.api.addr_validate(&cw20_msg.sender)?;

    match bet.side {
        Side::Yes => {
            let prev = STAKE_YES
                .may_load(deps.storage, &better)?
                .unwrap_or_default();
            STAKE_YES.save(deps.storage, &better, &(prev + cw20_msg.amount))?;
            let total = TOTAL_YES.load(deps.storage)?;
            TOTAL_YES.save(deps.storage, &(total + cw20_msg.amount))?;
        }
        Side::No => {
            let prev = STAKE_NO
                .may_load(deps.storage, &better)?
                .unwrap_or_default();
            STAKE_NO.save(deps.storage, &better, &(prev + cw20_msg.amount))?;
            let total = TOTAL_NO.load(deps.storage)?;
            TOTAL_NO.save(deps.storage, &(total + cw20_msg.amount))?;
        }
    }

    let side_str = match bet.side {
        Side::Yes => "yes",
        Side::No => "no",
    };

    Ok(Response::new()
        .add_attribute("action", "bet")
        .add_attribute("user", better)
        .add_attribute("side", side_str)
        .add_attribute("amount", cw20_msg.amount))
}

/// 1. only resolver
/// 2. not already settled
/// 3. store outcome
fn exec_settle(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    outcome: Outcome,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.resolver {
        return Err(ContractError::Unauthorized {});
    }
    let existing = OUTCOME.load(deps.storage)?;
    if existing.is_some() {
        return Err(ContractError::AlreadySettled {});
    }
    // Do not freeze betting / settle before the market has closed.
    if _env.block.time.seconds() < config.closes_at {
        return Err(ContractError::TooEarly {});
    }

    OUTCOME.save(deps.storage, &Some(outcome.clone()))?;

    let outcome_str = match outcome {
        Outcome::Yes => "yes",
        Outcome::No => "no",
        Outcome::Void => "void",
    };

    Ok(Response::new()
        .add_attribute("action", "settle")
        .add_attribute("outcome", outcome_str))
}

/// Parimutuel payout:
/// - Yes wins → stake_yes * (total_yes + total_no) / total_yes
/// - No wins  → stake_no  * (total_yes + total_no) / total_no
/// - Void     → stake_yes + stake_no refund
fn exec_claim(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let outcome = OUTCOME
        .load(deps.storage)?
        .ok_or(ContractError::NotSettled {})?;

    let stake_yes = STAKE_YES
        .may_load(deps.storage, &info.sender)?
        .unwrap_or_default();
    let stake_no = STAKE_NO
        .may_load(deps.storage, &info.sender)?
        .unwrap_or_default();

    let total_yes = TOTAL_YES.load(deps.storage)?;
    let total_no = TOTAL_NO.load(deps.storage)?;

    let payout = match outcome {
        Outcome::Yes => {
            if stake_yes.is_zero() {
                return Err(ContractError::NothingToClaim {});
            }
            if total_yes.is_zero() {
                return Err(ContractError::NothingToClaim {});
            }
            // stake_yes * (1 + total_no / total_yes) = stake_yes * pool / total_yes
            let pool = total_yes
                .checked_add(total_no)
                .map_err(cosmwasm_std::StdError::from)?;
            stake_yes.multiply_ratio(pool, total_yes)
        }
        Outcome::No => {
            if stake_no.is_zero() {
                return Err(ContractError::NothingToClaim {});
            }
            if total_no.is_zero() {
                return Err(ContractError::NothingToClaim {});
            }
            let pool = total_yes
                .checked_add(total_no)
                .map_err(cosmwasm_std::StdError::from)?;
            stake_no.multiply_ratio(pool, total_no)
        }
        Outcome::Void => {
            let refund = stake_yes
                .checked_add(stake_no)
                .map_err(cosmwasm_std::StdError::from)?;
            if refund.is_zero() {
                return Err(ContractError::NothingToClaim {});
            }
            refund
        }
    };

    // Zero stakes so claim is one-shot
    if !stake_yes.is_zero() {
        STAKE_YES.remove(deps.storage, &info.sender);
    }
    if !stake_no.is_zero() {
        STAKE_NO.remove(deps.storage, &info.sender);
    }

    let transfer = CosmosMsg::Wasm(WasmMsg::Execute {
        contract_addr: config.usdc.to_string(),
        msg: to_json_binary(&Cw20ExecuteMsg::Transfer {
            recipient: info.sender.to_string(),
            amount: payout,
        })?,
        funds: vec![],
    });

    Ok(Response::new()
        .add_message(transfer)
        .add_attribute("action", "claim")
        .add_attribute("user", info.sender)
        .add_attribute("payout", payout))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::State {} => {
            let config = CONFIG.load(deps.storage)?;
            let outcome = OUTCOME.load(deps.storage)?;
            let total_yes = TOTAL_YES.load(deps.storage)?;
            let total_no = TOTAL_NO.load(deps.storage)?;
            to_json_binary(&StateResp {
                usdc: config.usdc,
                resolver: config.resolver,
                question: config.question,
                closes_at: config.closes_at,
                outcome,
                total_yes,
                total_no,
            })
        }
        QueryMsg::Stake { user, side } => {
            let addr = deps.api.addr_validate(&user)?;
            let amount = match side {
                Side::Yes => STAKE_YES.may_load(deps.storage, &addr)?.unwrap_or_default(),
                Side::No => STAKE_NO.may_load(deps.storage, &addr)?.unwrap_or_default(),
            };
            to_json_binary(&StakeResp { amount })
        }
    }
}
