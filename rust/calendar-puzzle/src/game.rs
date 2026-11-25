use crate::config::at_anchor;
use crate::{Cell, Config, Date, Orientation, Status};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

const SAVE_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PieceState {
    id: String,
    anchor: Option<Cell>,
    rotation: u32,
    flipped: bool,
}

impl PieceState {
    fn orientation(&self) -> Orientation {
        Orientation {
            rotation: self.rotation,
            flipped: self.flipped,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Save<P> {
    version: u32,
    date: String,
    weekday: u8,
    board_version: String,
    piece_set_version: String,
    steps: u32,
    pieces: Vec<P>,
}

#[derive(Serialize)]
struct SnapshotPiece {
    #[serde(flatten)]
    state: PieceState,
    cells: Vec<Cell>,
}

#[derive(Serialize)]
struct Snapshot {
    #[serde(flatten)]
    save_info: Save<SnapshotPiece>,
    complete: bool,
    used: usize,
    remaining: usize,
    targets: [Cell; 3],
}

pub struct Game {
    config: Arc<Config>,
    date: Date,
    targets: [Cell; 3],
    pieces: Vec<PieceState>,
    steps: u32,
    complete: bool,
}

impl Game {
    pub fn new(config: Arc<Config>, date: Date, serialized: Option<&str>) -> Result<Self, String> {
        let targets = config.targets(date);
        let pieces = config
            .pieces
            .iter()
            .map(|piece| PieceState {
                id: piece.id.clone(),
                anchor: None,
                rotation: 0,
                flipped: false,
            })
            .collect();
        let mut game = Self {
            config,
            date,
            targets,
            pieces,
            steps: 0,
            complete: false,
        };
        if let Some(serialized) = serialized {
            game.restore(serialized)?;
        }
        Ok(game)
    }

    fn restore(&mut self, serialized: &str) -> Result<(), String> {
        let save: Save<PieceState> =
            serde_json::from_str(serialized).map_err(|error| format!("存档格式错误：{error}"))?;
        if save.version != SAVE_VERSION
            || save.board_version != self.config.board_version
            || save.piece_set_version != self.config.piece_set_version
        {
            return Err("存档版本与配置不匹配".into());
        }
        if save.date != self.date.iso() || save.weekday != self.date.weekday() {
            return Err("存档日期或星期与本局不匹配".into());
        }
        if save.pieces.len() != self.pieces.len()
            || (save.steps as usize)
                < save
                    .pieces
                    .iter()
                    .filter(|piece| piece.anchor.is_some())
                    .count()
        {
            return Err("存档拼图块数量或步数无效".into());
        }
        let mut by_id = HashMap::new();
        for piece in save.pieces {
            Orientation::new(piece.rotation, piece.flipped)?;
            if by_id.insert(piece.id.clone(), piece).is_some() {
                return Err("存档含有重复的拼图块 ID".into());
            }
        }
        let mut occupied = HashSet::new();
        for (index, state) in self.pieces.iter_mut().enumerate() {
            let piece = by_id.remove(&state.id).ok_or("存档缺少已知拼图块")?;
            if let Some(anchor) = piece.anchor {
                let cells = piece.orientation().cells(&self.config.pieces[index].cells);
                let cells = at_anchor(&cells, anchor).ok_or("存档拼图块超出棋盘")?;
                if cells
                    .into_iter()
                    .any(|cell| !self.config.board.contains(&cell) || !occupied.insert(cell))
                {
                    return Err("存档含有越界或重叠的拼图块".into());
                }
            }
            *state = piece;
        }
        self.steps = save.steps;
        self.update_completion();
        Ok(())
    }

    fn save<P>(&self, pieces: Vec<P>) -> Save<P> {
        Save {
            version: SAVE_VERSION,
            date: self.date.iso(),
            weekday: self.date.weekday(),
            board_version: self.config.board_version.clone(),
            piece_set_version: self.config.piece_set_version.clone(),
            steps: self.steps,
            pieces,
        }
    }

    pub fn serialize(&self) -> String {
        serde_json::to_string(&self.save(self.pieces.clone())).expect("game save is serializable")
    }

    pub fn snapshot(&self) -> String {
        let used = self
            .pieces
            .iter()
            .filter(|piece| piece.anchor.is_some())
            .count();
        let pieces = self
            .pieces
            .iter()
            .enumerate()
            .map(|(index, state)| SnapshotPiece {
                state: state.clone(),
                cells: self.local_cells(index, state.orientation()),
            })
            .collect();
        let snapshot = Snapshot {
            save_info: self.save(pieces),
            complete: self.complete,
            used,
            remaining: self.pieces.len() - used,
            targets: self.targets,
        };
        serde_json::to_string(&snapshot).expect("game snapshot is serializable")
    }

    pub fn is_complete(&self) -> bool {
        self.complete
    }

    pub fn steps(&self) -> u32 {
        self.steps
    }

    fn index(&self, id: &str) -> Result<usize, String> {
        self.config
            .pieces
            .iter()
            .position(|piece| piece.id == id)
            .ok_or_else(|| format!("未知的拼图块 ID：{id}"))
    }

    fn local_cells(&self, index: usize, orientation: Orientation) -> Vec<Cell> {
        orientation.cells(&self.config.pieces[index].cells)
    }

    pub fn oriented(&self, id: &str, orientation: Orientation) -> Result<Vec<Cell>, String> {
        let index = self.index(id)?;
        Ok(self.local_cells(index, orientation))
    }

    fn occupied_by(&self, index: usize) -> Option<Vec<Cell>> {
        let state = &self.pieces[index];
        at_anchor(&self.local_cells(index, state.orientation()), state.anchor?)
    }

    fn candidate(&self, index: usize, anchor: Cell, orientation: Orientation) -> Option<Vec<Cell>> {
        let cells = at_anchor(&self.local_cells(index, orientation), anchor)?;
        if cells.iter().any(|cell| !self.config.board.contains(cell)) {
            return None;
        }
        let overlaps = (0..self.pieces.len())
            .filter(|&other| other != index)
            .filter_map(|other| self.occupied_by(other))
            .flatten()
            .any(|cell| cells.contains(&cell));
        if overlaps {
            None
        } else {
            Some(cells)
        }
    }

    pub fn fits(&self, id: &str, anchor: Cell, orientation: Orientation) -> Result<bool, String> {
        Ok(self
            .candidate(self.index(id)?, anchor, orientation)
            .is_some())
    }

    fn set_state(&mut self, index: usize, anchor: Option<Cell>, orientation: Orientation) {
        let state = &mut self.pieces[index];
        state.anchor = anchor;
        state.rotation = orientation.rotation;
        state.flipped = orientation.flipped;
    }

    fn ensure_active(&self) -> Result<(), String> {
        if self.complete {
            Err("本局已完成".into())
        } else {
            Ok(())
        }
    }

    fn commit(
        &mut self,
        index: usize,
        anchor: Cell,
        orientation: Orientation,
        cells: Vec<Cell>,
    ) -> Result<(), String> {
        if self.occupied_by(index).as_ref() != Some(&cells) {
            self.steps = self.steps.checked_add(1).ok_or("步数已达上限")?;
        }
        self.set_state(index, Some(anchor), orientation);
        self.update_completion();
        Ok(())
    }

    pub fn place(
        &mut self,
        id: &str,
        anchor: Cell,
        orientation: Orientation,
    ) -> Result<bool, String> {
        self.ensure_active()?;
        let index = self.index(id)?;
        let Some(cells) = self.candidate(index, anchor, orientation) else {
            return Ok(false);
        };
        self.commit(index, anchor, orientation, cells)?;
        Ok(true)
    }

    pub fn release(
        &mut self,
        id: &str,
        orientation: Orientation,
        anchor: Option<Cell>,
    ) -> Result<bool, String> {
        if let Some(anchor) = anchor {
            if self.place(id, anchor, orientation)? {
                return Ok(true);
            }
        }
        self.ensure_active()?;
        let index = self.index(id)?;
        self.set_state(index, None, orientation);
        Ok(false)
    }

    pub fn orient(&mut self, id: &str, orientation: Orientation) -> Result<bool, String> {
        self.ensure_active()?;
        let index = self.index(id)?;
        if let Some(anchor) = self.pieces[index].anchor {
            return self.place(id, anchor, orientation);
        }
        self.set_state(index, None, orientation);
        Ok(true)
    }

    pub fn recycle_all(&mut self) -> Result<(), String> {
        self.ensure_active()?;
        for index in 0..self.pieces.len() {
            self.set_state(index, None, Orientation::DEFAULT);
        }
        Ok(())
    }

    fn update_completion(&mut self) {
        if self.config.status != Status::Confirmed
            || self.pieces.iter().any(|piece| piece.anchor.is_none())
        {
            self.complete = false;
            return;
        }
        let covered: HashSet<_> = (0..self.pieces.len())
            .filter_map(|index| self.occupied_by(index))
            .flatten()
            .collect();
        self.complete = self
            .config
            .board
            .iter()
            .all(|cell| covered.contains(cell) != self.targets.contains(cell));
    }
}
