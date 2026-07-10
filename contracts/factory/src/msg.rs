use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Addr;

#[cw_serde]
pub struct InstantiateMsg {
    pub market_code_id: u64,
    pub usdc: String,
    pub resolver: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    CreateMarket { question: String, closes_at: u64 },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    #[returns(ConfigResp)]
    Config {},
    #[returns(MarketsResp)]
    Markets {},
}

#[cw_serde]
pub struct ConfigResp {
    pub market_code_id: u64,
    pub usdc: Addr,
    pub resolver: Addr,
}

#[cw_serde]
pub struct MarketsResp {
    pub markets: Vec<Addr>,
}
