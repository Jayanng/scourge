use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Addr, Uint128};
use cw20::Cw20ReceiveMsg;

#[cw_serde]
pub struct InstantiateMsg {
    /// CW20 USDC contract address
    pub usdc: String,
    /// Resolver agent address (only this addr may settle)
    pub resolver: String,
    pub question: String,
    /// Unix seconds
    pub closes_at: u64,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Called via CW20 Send hook with amount + side
    Receive(Cw20ReceiveMsg),
    Settle { outcome: Outcome },
    Claim {},
}

#[cw_serde]
pub enum Outcome {
    Yes,
    No,
    Void,
}

#[cw_serde]
pub enum Side {
    Yes,
    No,
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(StateResp)]
    State {},
    #[returns(StakeResp)]
    Stake { user: String, side: Side },
}

#[cw_serde]
pub struct StateResp {
    pub usdc: Addr,
    pub resolver: Addr,
    pub question: String,
    pub closes_at: u64,
    pub outcome: Option<Outcome>,
    pub total_yes: Uint128,
    pub total_no: Uint128,
}

#[cw_serde]
pub struct StakeResp {
    pub amount: Uint128,
}

/// Msg embedded in CW20 Receive
#[cw_serde]
pub struct BetMsg {
    pub side: Side,
}
