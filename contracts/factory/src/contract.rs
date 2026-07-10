//! Market factory — CreateMarket via Wasm Instantiate2 (keccak salt) + reply.

#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;
use cosmwasm_std::{
    to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Order, Reply, Response, StdResult,
    SubMsg, SubMsgResult, WasmMsg,
};
use cw2::set_contract_version;
use cw_utils::parse_instantiate_response_data;
use sha3::{Digest, Keccak256};

use crate::error::ContractError;
use crate::msg::{ConfigResp, ExecuteMsg, InstantiateMsg, MarketsResp, QueryMsg};
use crate::state::{Config, CONFIG, MARKETS, MARKET_COUNT};

const CONTRACT_NAME: &str = "crates.io:kickoff-factory";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const REPLY_CREATE_MARKET: u64 = 1;

/// salt = keccak256(question || closes_at_be_bytes)
pub fn market_salt(question: &str, closes_at: u64) -> Binary {
    let mut hasher = Keccak256::new();
    hasher.update(question.as_bytes());
    hasher.update(closes_at.to_be_bytes());
    Binary::from(hasher.finalize().to_vec())
}

/// Local mirror of kickoff_market::InstantiateMsg (avoids hard dep in release wasm).
#[cosmwasm_schema::cw_serde]
struct MarketInstantiateMsg {
    usdc: String,
    resolver: String,
    question: String,
    closes_at: u64,
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let config = Config {
        market_code_id: msg.market_code_id,
        usdc: deps.api.addr_validate(&msg.usdc)?,
        resolver: deps.api.addr_validate(&msg.resolver)?,
    };
    CONFIG.save(deps.storage, &config)?;
    MARKET_COUNT.save(deps.storage, &0u64)?;

    Ok(Response::new()
        .add_attribute("action", "instantiate_factory")
        .add_attribute("market_code_id", msg.market_code_id.to_string()))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::CreateMarket {
            question,
            closes_at,
        } => exec_create_market(deps, env, info, question, closes_at),
    }
}

fn exec_create_market(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    question: String,
    closes_at: u64,
) -> Result<Response, ContractError> {
    if question.trim().is_empty() {
        return Err(ContractError::EmptyQuestion {});
    }
    if closes_at <= env.block.time.seconds() {
        return Err(ContractError::InvalidClosesAt {});
    }

    let config = CONFIG.load(deps.storage)?;
    let salt = market_salt(&question, closes_at);

    let init_msg = to_json_binary(&MarketInstantiateMsg {
        usdc: config.usdc.to_string(),
        resolver: config.resolver.to_string(),
        question: question.clone(),
        closes_at,
    })?;

    let count = MARKET_COUNT.load(deps.storage)?;
    let label = format!("kickoff-market-{}", count);

    // Instantiate2 with deterministic salt; address captured in reply
    let instantiate = WasmMsg::Instantiate2 {
        admin: Some(env.contract.address.to_string()),
        code_id: config.market_code_id,
        label,
        msg: init_msg,
        funds: vec![],
        salt,
    };

    Ok(Response::new()
        .add_submessage(SubMsg::reply_on_success(instantiate, REPLY_CREATE_MARKET))
        .add_attribute("action", "market_creating")
        .add_attribute("question", question)
        .add_attribute("closes_at", closes_at.to_string()))
}

/// Extract new contract address from an instantiate / instantiate2 reply.
fn contract_address_from_reply(msg: Reply) -> Result<String, ContractError> {
    let response = match msg.result {
        SubMsgResult::Ok(r) => r,
        SubMsgResult::Err(e) => {
            return Err(ContractError::Std(cosmwasm_std::StdError::generic_err(e)));
        }
    };

    // CosmWasm 2.x typed msg_responses
    for resp in &response.msg_responses {
        if let Ok(parsed) = parse_instantiate_response_data(resp.value.as_slice()) {
            if !parsed.contract_address.is_empty() {
                return Ok(parsed.contract_address);
            }
        }
    }

    // Event attributes (cw-multi-test + many chains)
    for event in &response.events {
        for attr in &event.attributes {
            if attr.key == "_contract_address" || attr.key == "contract_address" {
                return Ok(attr.value.clone());
            }
        }
    }

    Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
        "could not parse market address from instantiate reply",
    )))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn reply(deps: DepsMut, _env: Env, msg: Reply) -> Result<Response, ContractError> {
    match msg.id {
        REPLY_CREATE_MARKET => {
            let addr_str = contract_address_from_reply(msg)?;
            let market_addr = deps.api.addr_validate(&addr_str)?;

            let count = MARKET_COUNT.load(deps.storage)?;
            MARKETS.save(deps.storage, count, &market_addr)?;
            MARKET_COUNT.save(deps.storage, &(count + 1))?;

            Ok(Response::new()
                .add_attribute("action", "market_created")
                .add_attribute("addr", market_addr))
        }
        id => Err(ContractError::Std(cosmwasm_std::StdError::generic_err(
            format!("unknown reply id: {id}"),
        ))),
    }
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => {
            let config = CONFIG.load(deps.storage)?;
            to_json_binary(&ConfigResp {
                market_code_id: config.market_code_id,
                usdc: config.usdc,
                resolver: config.resolver,
            })
        }
        QueryMsg::Markets {} => {
            let markets: Vec<_> = MARKETS
                .range(deps.storage, None, None, Order::Ascending)
                .filter_map(|r| r.ok().map(|(_, addr)| addr))
                .collect();
            to_json_binary(&MarketsResp { markets })
        }
    }
}
