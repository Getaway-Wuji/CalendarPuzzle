use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub type Cell = [i32; 2];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Preview,
    Confirmed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LabelType {
    Month,
    Day,
    Weekday,
}

#[derive(Debug, Deserialize)]
pub struct Label {
    x: i32,
    y: i32,
    #[serde(rename = "type")]
    kind: LabelType,
    value: u8,
    text: String,
}

#[derive(Debug, Deserialize)]
pub struct Piece {
    pub id: String,
    pub cells: Vec<Cell>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConfig {
    board_version: String,
    piece_set_version: String,
    status: Status,
    board_mask: Vec<Cell>,
    cell_labels: Vec<Label>,
    piece_definitions: Vec<Piece>,
    visual_config: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug)]
pub struct Config {
    pub board_version: String,
    pub piece_set_version: String,
    pub status: Status,
    pub board: HashSet<Cell>,
    pub pieces: Vec<Piece>,
    pub visual_config: serde_json::Map<String, serde_json::Value>,
    labels: HashMap<(LabelType, u8), Cell>,
}

fn neighbors([x, y]: Cell) -> [Cell; 4] {
    [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
}

fn validate_piece(piece: &Piece) -> Result<(), String> {
    let start = *piece
        .cells
        .first()
        .ok_or_else(|| format!("拼图块 {} 没有占格", piece.id))?;
    let cells: HashSet<_> = piece.cells.iter().copied().collect();
    if cells.len() != piece.cells.len() {
        return Err(format!("拼图块 {} 有重复占格", piece.id));
    }
    let limit = piece.cells.len() as i32;
    for axis in 0..2 {
        if !cells.iter().any(|cell| cell[axis] == 0)
            || cells.iter().any(|cell| !(0..limit).contains(&cell[axis]))
        {
            return Err(format!("拼图块 {} 的局部坐标未归一到原点", piece.id));
        }
    }
    let mut visited = HashSet::from([start]);
    let mut pending = vec![start];
    while let Some(cell) = pending.pop() {
        for neighbor in neighbors(cell) {
            if cells.contains(&neighbor) && visited.insert(neighbor) {
                pending.push(neighbor);
            }
        }
    }
    if visited.len() != cells.len() {
        return Err(format!("拼图块 {} 的占格不连通", piece.id));
    }
    Ok(())
}

impl Config {
    pub fn parse_json(json: &str) -> Result<Self, String> {
        let raw: RawConfig =
            serde_json::from_str(json).map_err(|error| format!("配置格式错误：{error}"))?;
        if raw.board_version.trim().is_empty() || raw.piece_set_version.trim().is_empty() {
            return Err("配置版本不能为空".into());
        }
        let board: HashSet<_> = raw.board_mask.iter().copied().collect();
        if board.len() != 50 || board.len() != raw.board_mask.len() {
            return Err("棋盘必须包含 50 个互不重复的有效格".into());
        }
        if board
            .iter()
            .flatten()
            .any(|&axis| !(0..i32::MAX).contains(&axis))
        {
            return Err("棋盘坐标必须是非负整数，且给相邻坐标留出一个单位".into());
        }
        let mut labeled = HashSet::new();
        let mut texts = HashSet::new();
        let mut labels = HashMap::new();
        for label in raw.cell_labels {
            let cell = [label.x, label.y];
            let max_value = match label.kind {
                LabelType::Month => 12,
                LabelType::Day => 31,
                LabelType::Weekday => 7,
            };
            if !board.contains(&cell) || !labeled.insert(cell) {
                return Err(format!("标签坐标无效或重复：{cell:?}"));
            }
            if label.text.trim().is_empty() || !texts.insert(label.text) {
                return Err(format!("标签文字为空或重复：{cell:?}"));
            }
            if !(1..=max_value).contains(&label.value)
                || labels.insert((label.kind, label.value), cell).is_some()
            {
                return Err(format!(
                    "标签值无效或重复：{:?} {}",
                    label.kind, label.value
                ));
            }
        }
        if labeled != board {
            return Err("每个有效格都需要一个月份、日期或星期标签".into());
        }

        let mut ids = HashSet::new();
        let area: usize = raw
            .piece_definitions
            .iter()
            .map(|piece| piece.cells.len())
            .sum();
        if area > board.len() - 3 || (raw.status == Status::Confirmed && area != board.len() - 3) {
            return Err(format!("拼图总面积为 {area} 格，完整配置需要 47 格"));
        }
        for piece in &raw.piece_definitions {
            if piece.id.trim().is_empty() || !ids.insert(&piece.id) {
                return Err(format!("拼图块 ID 为空或重复：{}", piece.id));
            }
            validate_piece(piece)?;
        }

        Ok(Self {
            board_version: raw.board_version,
            piece_set_version: raw.piece_set_version,
            status: raw.status,
            board,
            pieces: raw.piece_definitions,
            visual_config: raw.visual_config,
            labels,
        })
    }

    pub fn targets(&self, date: Date) -> [Cell; 3] {
        [
            self.labels[&(LabelType::Month, date.month)],
            self.labels[&(LabelType::Day, date.day)],
            self.labels[&(LabelType::Weekday, date.weekday())],
        ]
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Date {
    pub(crate) year: u32,
    pub(crate) month: u8,
    pub(crate) day: u8,
}

impl Date {
    pub fn parse(iso: &str) -> Result<Self, String> {
        let bytes = iso.as_bytes();
        if bytes.len() != 10
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || !bytes[..4]
                .iter()
                .chain(&bytes[5..7])
                .chain(&bytes[8..])
                .all(u8::is_ascii_digit)
        {
            return Err("日期必须使用 YYYY-MM-DD 格式".into());
        }
        let year = iso[..4].parse::<u32>().unwrap();
        let month = iso[5..7].parse::<u8>().unwrap();
        let day = iso[8..].parse::<u8>().unwrap();
        if year == 0 || day == 0 || day > Self::days_in_month(year, month) {
            return Err(format!("无效的公历日期：{iso}"));
        }
        Ok(Self { year, month, day })
    }

    pub(crate) fn days_in_month(year: u32, month: u8) -> u8 {
        match month {
            2 if year.is_multiple_of(400)
                || (year.is_multiple_of(4) && !year.is_multiple_of(100)) =>
            {
                29
            }
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            _ => 0,
        }
    }

    pub fn iso(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }

    pub fn weekday(self) -> u8 {
        let years = self.year - 1;
        let days_in_years = years * 365 + years / 4 - years / 100 + years / 400;
        let days_in_months: u32 = (1..self.month)
            .map(|month| u32::from(Self::days_in_month(self.year, month)))
            .sum();
        ((days_in_years + days_in_months + u32::from(self.day) - 1) % 7 + 1) as u8
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct Orientation {
    pub(crate) rotation: u32,
    pub(crate) flipped: bool,
}

impl Orientation {
    pub const DEFAULT: Self = Self {
        rotation: 0,
        flipped: false,
    };

    pub fn new(rotation: u32, flipped: bool) -> Result<Self, String> {
        if rotation >= 4 {
            return Err("拼图朝向必须是 0–3 个四分之一转".into());
        }
        Ok(Self { rotation, flipped })
    }

    pub fn cells(self, source: &[Cell]) -> Vec<Cell> {
        let mut cells: Vec<_> = source
            .iter()
            .map(|&[mut x, mut y]| {
                if self.flipped {
                    x = -x;
                }
                for _ in 0..self.rotation {
                    [x, y] = [-y, x];
                }
                [x, y]
            })
            .collect();
        let min_x = cells.iter().map(|&[x, _]| x).min().unwrap_or_default();
        let min_y = cells.iter().map(|&[_, y]| y).min().unwrap_or_default();
        for [x, y] in &mut cells {
            *x -= min_x;
            *y -= min_y;
        }
        cells.sort_unstable();
        cells
    }
}

pub(crate) fn at_anchor(cells: &[Cell], anchor: Cell) -> Option<Vec<Cell>> {
    cells
        .iter()
        .map(|&[x, y]| Some([anchor[0].checked_add(x)?, anchor[1].checked_add(y)?]))
        .collect()
}
