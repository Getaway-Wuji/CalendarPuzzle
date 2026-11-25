use calendar_puzzle_core::solver::{gregorian_targets, Outcome, Solver};
use calendar_puzzle_core::{Cell, Config, Date, Game, Orientation};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

const GEOMETRY: &str = include_str!("../../../src/calendar-puzzle/geometry.json");
const PHOTO_GEOMETRY: &str = include_str!("../../../docs/calendar-puzzle-photo.json");
const SOLVABILITY: &str = include_str!("../../../src/calendar-puzzle/solvability.json");
const REFERENCE_SOLUTION: &str = include_str!("../../../tests/calendar-photo-solution.json");
const INITIAL: Orientation = Orientation::DEFAULT;

fn config() -> Arc<Config> {
    Arc::new(Config::parse_json(GEOMETRY).unwrap())
}

fn game() -> Game {
    Game::new(config(), Date::parse("2021-06-20").unwrap(), None).unwrap()
}

fn snapshot(game: &Game) -> Value {
    serde_json::from_str(&game.snapshot()).unwrap()
}

fn piece(game: &Game, id: &str) -> Value {
    snapshot(game)["pieces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|piece| piece["id"] == id)
        .unwrap()
        .clone()
}

#[test]
fn geometry_checks_complete_labels_unique_ids_connected_pieces_and_cover_area() {
    let config = config();
    assert_eq!(config.board.len(), 50);
    assert_eq!(config.pieces.len(), 11);
    assert_eq!(config.piece_set_version, "same-board-all-dates-v1");
    assert_eq!(
        config
            .pieces
            .iter()
            .map(|piece| piece.cells.len())
            .sum::<usize>(),
        47
    );

    let source: Value = serde_json::from_str(GEOMETRY).unwrap();
    let mut duplicate_label = source.clone();
    duplicate_label["cellLabels"][1]["value"] = duplicate_label["cellLabels"][0]["value"].clone();
    assert!(Config::parse_json(&duplicate_label.to_string()).is_err());
    let mut missing_label = source.clone();
    missing_label["cellLabels"].as_array_mut().unwrap().pop();
    assert!(Config::parse_json(&missing_label.to_string()).is_err());
    let mut duplicate_id = source.clone();
    duplicate_id["pieceDefinitions"][1]["id"] = duplicate_id["pieceDefinitions"][0]["id"].clone();
    assert!(Config::parse_json(&duplicate_id.to_string()).is_err());
    let mut disconnected_piece = source.clone();
    disconnected_piece["pieceDefinitions"][0]["cells"] =
        json!([[0, 0], [1, 0], [2, 0], [3, 0], [4, 2]]);
    assert!(Config::parse_json(&disconnected_piece.to_string()).is_err());
    let mut bad_area = source;
    bad_area["pieceDefinitions"].as_array_mut().unwrap().pop();
    assert!(Config::parse_json(&bad_area.to_string()).is_err());
    bad_area["status"] = json!("preview");
    assert!(Config::parse_json(&bad_area.to_string()).is_ok());
}

#[test]
fn orientations_rotate_clockwise_and_mirror_over_horizontal_coordinate() {
    let source = [[0, 0], [0, 1], [0, 2], [1, 2]];
    let rotation = Orientation::new(1, false).unwrap();
    let mirror = Orientation::new(0, true).unwrap();
    assert_eq!(rotation.cells(&source), [[0, 0], [0, 1], [1, 0], [2, 0]]);
    assert_eq!(mirror.cells(&source), [[0, 2], [1, 0], [1, 1], [1, 2]]);
    let rotated = (0..4).fold(source.to_vec(), |cells, _| rotation.cells(&cells));
    assert_eq!(rotated, source);
    assert_eq!(mirror.cells(&mirror.cells(&source)), source);
    assert!(Orientation::new(4, false).is_err());
}

#[test]
fn actual_shape_allows_concavity_and_excludes_original_cells_during_drag() {
    let mut game = game();
    assert!(game.place("G", [6, 3], INITIAL).unwrap());
    assert!(game.fits("G", [6, 3], INITIAL).unwrap());
    assert!(!game.fits("J", [6, 3], INITIAL).unwrap());
    assert!(game.place("J", [5, 3], INITIAL).unwrap());
    assert!(!game.fits("J", [6, 0], INITIAL).unwrap());
    assert!(!game.fits("J", [0, 5], INITIAL).unwrap());
    assert!(!game.fits("J", [-1, 7], INITIAL).unwrap());
    assert!(!game.fits("J", [i32::MAX, i32::MAX], INITIAL).unwrap());
    assert_eq!(snapshot(&game)["used"], 2);
    assert_eq!(snapshot(&game)["remaining"], 9);
}

#[test]
fn committed_steps_count_only_changes_in_legal_occupied_cells() {
    let mut game = game();
    let mirror = Orientation::new(0, true).unwrap();
    assert!(game.orient("J", mirror).unwrap());
    assert_eq!(game.steps(), 0);
    // A target can be covered while trying an arrangement.
    assert!(game.release("J", mirror, Some([4, 0])).unwrap());
    assert_eq!(game.steps(), 1);
    assert!(game.orient("J", INITIAL).unwrap());
    assert_eq!(game.steps(), 1);
    assert!(game.place("J", [3, 0], INITIAL).unwrap());
    assert_eq!(game.steps(), 2);
    assert!(game
        .orient("J", Orientation::new(1, false).unwrap())
        .unwrap());
    assert_eq!(game.steps(), 3);
    assert!(!game.place("J", [7, 7], INITIAL).unwrap());
    assert_eq!(game.steps(), 3);
    game.recycle_all().unwrap();
    assert_eq!(snapshot(&game)["used"], 0);
    assert_eq!(game.steps(), 3);
    assert_eq!(piece(&game, "J")["rotation"], 0);
}

#[test]
fn invalid_orientation_rolls_back_and_invalid_release_keeps_final_tray_orientation() {
    let mut game = game();
    assert!(game.place("A", [0, 0], INITIAL).unwrap());
    let invalid_orientation = Orientation::new(3, false).unwrap();
    let before = game.serialize();
    assert!(!game.orient("A", invalid_orientation).unwrap());
    assert_eq!(game.serialize(), before);
    // A canceled preview only queries geometry and therefore keeps the official board intact.
    assert!(!game.fits("A", [0, 0], invalid_orientation).unwrap());
    assert_ne!(
        game.oriented("A", invalid_orientation).unwrap(),
        game.oriented("A", INITIAL).unwrap()
    );
    assert_eq!(game.serialize(), before);
    assert!(!game
        .release("A", invalid_orientation, Some([0, 0]))
        .unwrap());
    assert_eq!(piece(&game, "A")["anchor"], Value::Null);
    assert_eq!(piece(&game, "A")["rotation"], 3);
    assert_eq!(game.steps(), 1);
    assert!(game.place("J", [0, 0], INITIAL).unwrap());
    assert!(!game.release("J", INITIAL, None).unwrap());
    assert_eq!(snapshot(&game)["used"], 0);
    assert_eq!(game.steps(), 2);
}

#[derive(Deserialize)]
struct ReferenceSolution {
    date: String,
    placements: Vec<ReferencePlacement>,
}

#[derive(Deserialize)]
struct ReferencePlacement {
    id: String,
    anchor: Cell,
    rotation: u32,
    flipped: bool,
}

fn apply_reference(game: &mut Game, solution: &ReferenceSolution) {
    for placement in &solution.placements {
        assert!(!game.is_complete());
        let orientation = Orientation::new(placement.rotation, placement.flipped).unwrap();
        assert!(game
            .place(&placement.id, placement.anchor, orientation)
            .unwrap());
    }
}

#[test]
fn reference_solution_exposes_exact_targets_and_stays_frozen_after_completion() {
    let solution: ReferenceSolution = serde_json::from_str(REFERENCE_SOLUTION).unwrap();
    let date = Date::parse(&solution.date).unwrap();
    let config = config();
    let mut correct = Game::new(config.clone(), date, None).unwrap();
    apply_reference(&mut correct, &solution);
    assert!(correct.is_complete());
    assert_eq!(correct.steps(), 11);
    assert_eq!(
        snapshot(&correct)["targets"],
        json!([[5, 0], [6, 4], [6, 7]])
    );
    assert!(correct.recycle_all().is_err());
    let restored = Game::new(config.clone(), date, Some(&correct.serialize())).unwrap();
    assert!(restored.is_complete());

    let mut wrong = Game::new(config, Date::parse("2026-11-17").unwrap(), None).unwrap();
    apply_reference(&mut wrong, &solution);
    assert_eq!(snapshot(&wrong)["used"], 11);
    assert!(!wrong.is_complete());
    assert!(!wrong.release("A", INITIAL, None).unwrap());
}

#[test]
fn restores_checked_saves_and_blocks_invalid_positions_versions_and_statistics() {
    let mut game = game();
    game.place("A", [0, 0], INITIAL).unwrap();
    game.place("J", [4, 0], INITIAL).unwrap();
    let config = config();
    let date = Date::parse("2021-06-20").unwrap();
    let save = game.serialize();
    assert_eq!(
        Game::new(config.clone(), date, Some(&save))
            .unwrap()
            .snapshot(),
        game.snapshot()
    );
    assert!(Game::new(
        config.clone(),
        Date::parse("2021-06-21").unwrap(),
        Some(&save)
    )
    .is_err());

    let valid: Value = serde_json::from_str(&save).unwrap();
    for (key, value) in [
        ("steps", json!(1)),
        ("weekday", json!(2)),
        ("steps", json!(-1)),
        ("steps", json!(2.5)),
        ("boardVersion", json!("older-board")),
        ("pieceSetVersion", json!("older-pieces")),
        ("version", json!(0)),
    ] {
        let mut malformed = valid.clone();
        malformed[key] = value;
        assert!(Game::new(config.clone(), date, Some(&malformed.to_string())).is_err());
    }
    for (key, value) in [
        ("anchor", json!([4, 0])),
        ("anchor", json!([6, 4])),
        ("id", json!("J")),
        ("id", json!("missing")),
        ("rotation", json!(4)),
    ] {
        let mut malformed = valid.clone();
        malformed["pieces"][0][key] = value;
        assert!(Game::new(config.clone(), date, Some(&malformed.to_string())).is_err());
    }
}

#[test]
fn dates_handle_gregorian_leap_centuries_and_weekday_boundaries() {
    for (iso, weekday) in [
        ("0001-01-01", 1),
        ("1900-02-28", 3),
        ("1900-03-01", 4),
        ("2000-02-28", 1),
        ("2000-02-29", 2),
        ("2000-03-01", 3),
        ("2024-12-31", 2),
        ("2025-01-01", 3),
        ("9999-12-31", 5),
    ] {
        let date = Date::parse(iso).unwrap();
        assert_eq!(date.iso(), iso);
        assert_eq!(date.weekday(), weekday);
    }
    for invalid in [
        "0000-01-01",
        "1900-02-29",
        "2001-02-29",
        "2024-04-31",
        "2025-00-01",
        "2025-02-00",
        "2025-02-3",
        "2025-02-30",
        "10000-01-01",
        "２０２５-02-01",
    ] {
        assert!(Date::parse(invalid).is_err());
    }
    assert_eq!(gregorian_targets().len(), 366 * 7);
}

#[test]
fn exact_cover_distinguishes_solution_exhaustion_and_timeout() {
    let solver = Solver::new(config()).unwrap();
    let formerly_blocked = Date::parse("2026-11-17").unwrap();
    let solved = solver
        .solve(formerly_blocked, Duration::from_secs(5))
        .unwrap();
    assert!(matches!(solved, Outcome::Solved(placements) if placements.len() == 11));
    let photo_solver = Solver::new(Arc::new(Config::parse_json(PHOTO_GEOMETRY).unwrap())).unwrap();
    assert!(matches!(
        photo_solver
            .solve(formerly_blocked, Duration::from_secs(5))
            .unwrap(),
        Outcome::Unsolvable
    ));
    assert!(matches!(
        solver.solve(formerly_blocked, Duration::ZERO).unwrap(),
        Outcome::TimedOut
    ));
}

#[test]
fn full_gregorian_cycle_agrees_with_the_browser_solvability_report() {
    let config = config();
    let report: Value = serde_json::from_str(SOLVABILITY).unwrap();
    let days = report["days"].as_object().unwrap();
    assert_eq!(report["reportVersion"], 1);
    assert_eq!(report["boardVersion"], config.board_version);
    assert_eq!(report["pieceSetVersion"], config.piece_set_version);
    assert_eq!(report["unsolvable"], 0);
    assert_eq!(report["timedOut"], 0);
    assert_eq!(days.len(), 366);
    assert_eq!(report["solved"], days.len() * 7);

    let solver = Solver::new(config.clone()).unwrap();
    let dates = gregorian_targets();
    let mut targets = HashSet::new();
    for date in dates {
        let iso = date.iso();
        assert!(targets.insert(config.targets(date)), "重复的目标：{iso}");

        let statuses = days[&iso[5..]].as_str().unwrap();
        assert_eq!(statuses.len(), 7);
        assert_eq!(statuses.as_bytes()[usize::from(date.weekday()) - 1], b'S');

        // solve also submits each returned placement to the gameplay engine to check its win.
        let solution = solver.solve(date, Duration::from_secs(5)).unwrap();
        assert!(
            matches!(solution, Outcome::Solved(placements) if placements.len() == 11),
            "{iso} 星期{}",
            date.weekday()
        );
    }
    assert_eq!(targets.len(), days.len() * 7);
}
