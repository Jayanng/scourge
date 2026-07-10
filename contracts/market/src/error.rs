use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Market already settled")]
    AlreadySettled {},

    #[error("Market not yet settled")]
    NotSettled {},

    #[error("Market closed for betting")]
    MarketClosed {},

    #[error("Nothing to claim")]
    NothingToClaim {},

    #[error("Invalid zero amount")]
    ZeroAmount {},

    #[error("Cannot settle before market closes")]
    TooEarly {},
}
