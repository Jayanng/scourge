//! Minimal CW20-like token for Kickoff demo (mint + transfer + send hook).
use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdError,
    StdResult, Uint128, WasmMsg,
};
use cw2::set_contract_version;
use cw_storage_plus::{Item, Map};

const CONTRACT_NAME: &str = "crates.io:kickoff-mock-usdc";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cw_serde]
pub struct InstantiateMsg {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub initial_balances: Vec<Cw20Coin>,
}

#[cw_serde]
pub struct Cw20Coin {
    pub address: String,
    pub amount: Uint128,
}

#[cw_serde]
pub enum ExecuteMsg {
    Transfer { recipient: String, amount: Uint128 },
    Send {
        contract: String,
        amount: Uint128,
        msg: Binary,
    },
    Mint { recipient: String, amount: Uint128 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(BalanceResp)]
    Balance { address: String },
    #[returns(TokenInfoResp)]
    TokenInfo {},
}

#[cw_serde]
pub struct BalanceResp {
    pub balance: Uint128,
}

#[cw_serde]
pub struct TokenInfoResp {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Uint128,
}

#[cw_serde]
pub struct TokenInfo {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Uint128,
}

const TOKEN: Item<TokenInfo> = Item::new("token");
const MINTER: Item<Addr> = Item::new("minter");
const BALANCES: Map<&Addr, Uint128> = Map::new("balance");

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    let mut supply = Uint128::zero();
    for coin in msg.initial_balances {
        let addr = deps.api.addr_validate(&coin.address)?;
        BALANCES.save(deps.storage, &addr, &coin.amount)?;
        supply = supply.checked_add(coin.amount)?;
    }
    TOKEN.save(
        deps.storage,
        &TokenInfo {
            name: msg.name,
            symbol: msg.symbol,
            decimals: msg.decimals,
            total_supply: supply,
        },
    )?;
    MINTER.save(deps.storage, &info.sender)?;
    Ok(Response::new().add_attribute("action", "instantiate_mock_usdc"))
}

#[entry_point]
pub fn execute(deps: DepsMut, _env: Env, info: MessageInfo, msg: ExecuteMsg) -> StdResult<Response> {
    match msg {
        ExecuteMsg::Transfer { recipient, amount } => {
            let to = deps.api.addr_validate(&recipient)?;
            debit(deps.storage, &info.sender, amount)?;
            credit(deps.storage, &to, amount)?;
            Ok(Response::new()
                .add_attribute("action", "transfer")
                .add_attribute("from", info.sender)
                .add_attribute("to", to)
                .add_attribute("amount", amount))
        }
        ExecuteMsg::Send {
            contract,
            amount,
            msg,
        } => {
            let contract_addr = deps.api.addr_validate(&contract)?;
            debit(deps.storage, &info.sender, amount)?;
            credit(deps.storage, &contract_addr, amount)?;
            // CW20 Receive hook
            let hook = Cw20ReceiveMsg {
                sender: info.sender.to_string(),
                amount,
                msg,
            };
            let exec = WasmMsg::Execute {
                contract_addr: contract_addr.to_string(),
                msg: to_json_binary(&ReceiveWrapper::Receive(hook))?,
                funds: vec![],
            };
            Ok(Response::new()
                .add_message(exec)
                .add_attribute("action", "send")
                .add_attribute("from", info.sender)
                .add_attribute("to", contract_addr)
                .add_attribute("amount", amount))
        }
        ExecuteMsg::Mint { recipient, amount } => {
            let minter = MINTER.load(deps.storage)?;
            if info.sender != minter {
                return Err(StdError::generic_err("unauthorized"));
            }
            let to = deps.api.addr_validate(&recipient)?;
            credit(deps.storage, &to, amount)?;
            let mut token = TOKEN.load(deps.storage)?;
            token.total_supply = token.total_supply.checked_add(amount)?;
            TOKEN.save(deps.storage, &token)?;
            Ok(Response::new()
                .add_attribute("action", "mint")
                .add_attribute("to", to)
                .add_attribute("amount", amount))
        }
    }
}

/// Local Receive message (snake_case) so the market contract's
/// `Receive(Cw20ReceiveMsg)` hook deserializes correctly.
#[cw_serde]
pub struct Cw20ReceiveMsg {
    pub sender: String,
    pub amount: Uint128,
    pub msg: Binary,
}

/// Matches cw20 Receive execute on binary market
#[cw_serde]
enum ReceiveWrapper {
    Receive(Cw20ReceiveMsg),
}

fn debit(
    storage: &mut dyn cosmwasm_std::Storage,
    from: &Addr,
    amount: Uint128,
) -> StdResult<()> {
    let bal = BALANCES.may_load(storage, from)?.unwrap_or_default();
    if bal < amount {
        return Err(StdError::generic_err("insufficient funds"));
    }
    BALANCES.save(storage, from, &(bal - amount))?;
    Ok(())
}

fn credit(storage: &mut dyn cosmwasm_std::Storage, to: &Addr, amount: Uint128) -> StdResult<()> {
    let bal = BALANCES.may_load(storage, to)?.unwrap_or_default();
    BALANCES.save(storage, to, &(bal + amount))?;
    Ok(())
}

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Balance { address } => {
            let addr = deps.api.addr_validate(&address)?;
            let balance = BALANCES.may_load(deps.storage, &addr)?.unwrap_or_default();
            to_json_binary(&BalanceResp { balance })
        }
        QueryMsg::TokenInfo {} => {
            let t = TOKEN.load(deps.storage)?;
            to_json_binary(&TokenInfoResp {
                name: t.name,
                symbol: t.symbol,
                decimals: t.decimals,
                total_supply: t.total_supply,
            })
        }
    }
}

#[cfg(test)]
mod multitest;
