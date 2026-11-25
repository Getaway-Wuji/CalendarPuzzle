use crate::config::at_anchor;
use crate::{Cell, Config, Date, Game, Orientation, Status};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Serialize)]
pub struct Placement {
    pub id: String,
    pub anchor: Cell,
    #[serde(flatten)]
    pub orientation: Orientation,
}

#[derive(Debug)]
pub enum Outcome {
    Solved(Vec<Placement>),
    Unsolvable,
    TimedOut,
}

#[derive(Clone, Copy)]
struct Row {
    columns: u128,
    piece: usize,
    anchor: Cell,
    orientation: Orientation,
}

pub struct Solver {
    config: Arc<Config>,
    board_columns: HashMap<Cell, usize>,
    rows: Vec<Row>,
    by_column: Vec<Vec<usize>>,
}

impl Solver {
    pub fn new(config: Arc<Config>) -> Result<Self, String> {
        if config.status != Status::Confirmed {
            return Err("几何配置尚未确认，正式可解性验证未开始。".into());
        }
        let mut board: Vec<_> = config.board.iter().copied().collect();
        board.sort_unstable();
        let board_columns: HashMap<_, _> = board
            .iter()
            .enumerate()
            .map(|(index, &cell)| (cell, index))
            .collect();
        let mut rows = Vec::new();
        let mut by_column = vec![Vec::new(); board.len() + config.pieces.len()];
        for (piece, def) in config.pieces.iter().enumerate() {
            let piece_column = board.len() + piece;
            let mut seen_orientations = HashSet::new();
            for flipped in [false, true] {
                for rotation in 0..4 {
                    let orientation = Orientation { rotation, flipped };
                    let shape = orientation.cells(&def.cells);
                    if !seen_orientations.insert(shape.clone()) {
                        continue;
                    }
                    let first = shape[0];
                    for cell in &board {
                        let anchor = [cell[0] - first[0], cell[1] - first[1]];
                        let Some(cells) = at_anchor(&shape, anchor) else {
                            continue;
                        };
                        let board_mask = cells.iter().try_fold(0_u128, |mask, cell| {
                            board_columns
                                .get(cell)
                                .map(|&column| mask | (1_u128 << column))
                        });
                        let Some(board_mask) = board_mask else {
                            continue;
                        };
                        let columns = board_mask | (1_u128 << piece_column);
                        for column in set_columns(columns) {
                            by_column[column].push(rows.len());
                        }
                        rows.push(Row {
                            columns,
                            piece,
                            anchor,
                            orientation,
                        });
                    }
                }
            }
        }
        Ok(Self {
            config,
            board_columns,
            rows,
            by_column,
        })
    }

    pub fn solve(&self, date: Date, timeout: Duration) -> Result<Outcome, String> {
        let targets = self.config.targets(date);
        let excluded = targets.iter().fold(0_u128, |mask, target| {
            mask | (1_u128 << self.board_columns[target])
        });
        let all = (1_u128 << self.by_column.len()) - 1;
        let mut selected = Vec::with_capacity(self.config.pieces.len());
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or("搜索时限超出支持范围")?;
        match self.search(all, excluded, &mut selected, deadline) {
            Search::Solved => {
                let solution: Vec<_> = selected
                    .into_iter()
                    .map(|index| {
                        let row = self.rows[index];
                        Placement {
                            id: self.config.pieces[row.piece].id.clone(),
                            anchor: row.anchor,
                            orientation: row.orientation,
                        }
                    })
                    .collect();
                // The solver uses exact-cover columns. Recheck the result with the game engine's cell rules.
                let mut game = Game::new(self.config.clone(), date, None)?;
                for placement in &solution {
                    if !game.place(&placement.id, placement.anchor, placement.orientation)? {
                        return Err(format!(
                            "{} 搜索结果含非法摆放：{}",
                            date.iso(),
                            placement.id
                        ));
                    }
                }
                if !game.is_complete() || game.steps() as usize != self.config.pieces.len() {
                    return Err(format!("{} 搜索结果未通过独立通关校验", date.iso()));
                }
                Ok(Outcome::Solved(solution))
            }
            Search::Exhausted => Ok(Outcome::Unsolvable),
            Search::TimedOut => Ok(Outcome::TimedOut),
        }
    }

    fn search(
        &self,
        all: u128,
        used: u128,
        selected: &mut Vec<usize>,
        deadline: Instant,
    ) -> Search {
        if all == used {
            return Search::Solved;
        }
        if Instant::now() >= deadline {
            return Search::TimedOut;
        }

        // Branch on the cell or piece with the fewest still-compatible placements.
        let mut best_column = 0;
        let mut best_count = usize::MAX;
        for column in set_columns(all & !used) {
            let count = self.by_column[column]
                .iter()
                .filter(|&&row| self.rows[row].columns & used == 0)
                .take(best_count)
                .count();
            if count == 0 {
                return Search::Exhausted;
            }
            if count < best_count {
                best_count = count;
                best_column = column;
            }
        }
        for &index in &self.by_column[best_column] {
            let row = self.rows[index];
            if row.columns & used != 0 {
                continue;
            }
            selected.push(index);
            match self.search(all, used | row.columns, selected, deadline) {
                Search::Exhausted => {
                    selected.pop();
                }
                outcome => return outcome,
            }
        }
        Search::Exhausted
    }
}

enum Search {
    Solved,
    Exhausted,
    TimedOut,
}

fn set_columns(mut columns: u128) -> impl Iterator<Item = usize> {
    std::iter::from_fn(move || {
        if columns == 0 {
            return None;
        }
        let column = columns.trailing_zeros() as usize;
        columns &= columns - 1;
        Some(column)
    })
}

pub fn gregorian_targets() -> Vec<Date> {
    let mut seen = HashSet::new();
    let mut targets = Vec::new();
    // 400 Gregorian years contain an exact multiple of seven days.
    for year in 2000..2400 {
        for month in 1..=12 {
            for day in 1..=Date::days_in_month(year, month) {
                let date = Date { year, month, day };
                if seen.insert((month, day, date.weekday())) {
                    targets.push(date);
                }
            }
        }
    }
    targets
}
