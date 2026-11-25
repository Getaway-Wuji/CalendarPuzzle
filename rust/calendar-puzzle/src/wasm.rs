use crate::{Config, Date, Game, Orientation};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Puzzle(Game);

#[wasm_bindgen]
impl Puzzle {
    #[wasm_bindgen(constructor)]
    pub fn new(config: &str, date: &str, save: Option<String>) -> Result<Puzzle, JsError> {
        let config = Arc::new(Config::parse_json(config).map_err(error)?);
        let date = Date::parse(date).map_err(error)?;
        Game::new(config, date, save.as_deref())
            .map(Puzzle)
            .map_err(error)
    }

    pub fn snapshot(&self) -> String {
        self.0.snapshot()
    }

    pub fn serialize(&self) -> String {
        self.0.serialize()
    }

    pub fn oriented(&self, id: &str, rotation: u32, flipped: bool) -> Result<String, JsError> {
        let orientation = Orientation::new(rotation, flipped).map_err(error)?;
        let cells = self.0.oriented(id, orientation).map_err(error)?;
        Ok(serde_json::to_string(&cells).expect("oriented cells are serializable"))
    }

    pub fn fits(
        &self,
        id: &str,
        x: i32,
        y: i32,
        rotation: u32,
        flipped: bool,
    ) -> Result<bool, JsError> {
        let orientation = Orientation::new(rotation, flipped).map_err(error)?;
        self.0.fits(id, [x, y], orientation).map_err(error)
    }

    pub fn place(
        &mut self,
        id: &str,
        x: i32,
        y: i32,
        rotation: u32,
        flipped: bool,
    ) -> Result<bool, JsError> {
        let orientation = Orientation::new(rotation, flipped).map_err(error)?;
        self.0.place(id, [x, y], orientation).map_err(error)
    }

    pub fn release(
        &mut self,
        id: &str,
        rotation: u32,
        flipped: bool,
        x: Option<i32>,
        y: Option<i32>,
    ) -> Result<bool, JsError> {
        let orientation = Orientation::new(rotation, flipped).map_err(error)?;
        if x.is_some() != y.is_some() {
            return Err(JsError::new("释放坐标必须同时提供横轴和纵轴"));
        }
        let anchor = x.zip(y).map(|(x, y)| [x, y]);
        self.0.release(id, orientation, anchor).map_err(error)
    }

    pub fn orient(&mut self, id: &str, rotation: u32, flipped: bool) -> Result<bool, JsError> {
        let orientation = Orientation::new(rotation, flipped).map_err(error)?;
        self.0.orient(id, orientation).map_err(error)
    }

    #[wasm_bindgen(js_name = recycleAll)]
    pub fn recycle_all(&mut self) -> Result<(), JsError> {
        self.0.recycle_all().map_err(error)
    }
}

fn error(message: String) -> JsError {
    JsError::new(&message)
}
