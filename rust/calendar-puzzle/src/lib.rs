mod config;
mod game;

pub use config::{Cell, Config, Date, Orientation, Status};
pub use game::Game;

#[cfg(not(target_arch = "wasm32"))]
pub mod solver;

#[cfg(target_arch = "wasm32")]
mod wasm;
