use cosmwasm_schema::cw_serde;
use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};

use crate::msg::Outcome;

#[cw_serde]
pub struct Config {
    pub usdc: Addr,
    pub resolver: Addr,
    pub question: String,
    pub closes_at: u64,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const OUTCOME: Item<Option<Outcome>> = Item::new("outcome");
pub const TOTAL_YES: Item<Uint128> = Item::new("total_yes");
pub const TOTAL_NO: Item<Uint128> = Item::new("total_no");

/// Stake keyed by user address
pub const STAKE_YES: Map<&Addr, Uint128> = Map::new("stake_yes");
pub const STAKE_NO: Map<&Addr, Uint128> = Map::new("stake_no");
