use cosmwasm_schema::cw_serde;
use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};

#[cw_serde]
pub struct Config {
    pub market_code_id: u64,
    pub usdc: Addr,
    pub resolver: Addr,
}

pub const CONFIG: Item<Config> = Item::new("config");
/// index → market address
pub const MARKETS: Map<u64, Addr> = Map::new("markets");
pub const MARKET_COUNT: Item<u64> = Item::new("market_count");
