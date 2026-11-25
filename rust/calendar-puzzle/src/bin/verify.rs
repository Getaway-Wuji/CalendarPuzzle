#[cfg(not(target_arch = "wasm32"))]
mod native {
    use calendar_puzzle_core::solver::{gregorian_targets, Outcome, Solver};
    use calendar_puzzle_core::{Config, Date};
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::{Duration, Instant};

    pub fn run() -> Result<bool, String> {
        let mut args = std::env::args().skip(1);
        let mut path = None;
        let mut report = None;
        let mut date = None;
        let mut timeout_ms = 5000_u64;
        let mut jobs = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1)
            .min(16);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--date" => {
                    date = Some(Date::parse(&args.next().ok_or("--date 需要 YYYY-MM-DD")?)?)
                }
                "--timeout-ms" => {
                    timeout_ms = args
                        .next()
                        .ok_or("--timeout-ms 需要毫秒数")?
                        .parse()
                        .map_err(|_| "无效的时限")?
                }
                "--report" => {
                    report = Some(PathBuf::from(args.next().ok_or("--report 需要输出路径")?))
                }
                "--jobs" => {
                    jobs = args
                        .next()
                        .ok_or("--jobs 需要工作线程数")?
                        .parse()
                        .map_err(|_| "无效的线程数")?;
                    if jobs == 0 || jobs > 256 {
                        return Err("线程数必须在 1–256 之间".into());
                    }
                }
                "--help" | "-h" => {
                    println!("verify [配置.json] [--date YYYY-MM-DD] [--timeout-ms 5000] [--jobs 线程数] [--report 输出.json]");
                    return Ok(true);
                }
                _ if !arg.starts_with('-') && path.is_none() => path = Some(PathBuf::from(arg)),
                _ => return Err(format!("未知的参数：{arg}")),
            }
        }
        if report.is_some() && date.is_some() {
            return Err("--report 需要验证全部日期组合".into());
        }
        let path = path.unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../src/calendar-puzzle/geometry.json")
        });
        let json = std::fs::read_to_string(&path)
            .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
        let config = Arc::new(Config::parse_json(&json)?);
        let solver = Solver::new(config.clone())?;
        let targets = date.map_or_else(gregorian_targets, |date| vec![date]);
        let jobs = jobs.min(targets.len());
        let timeout = Duration::from_millis(timeout_ms);
        println!(
            "棋盘 {}　拼图 {}（{} 块）",
            config.board_version,
            config.piece_set_version,
            config.pieces.len()
        );
        println!(
            "验证 {} 个目标组合，每个限时 {} 毫秒，{} 个工作线程。",
            targets.len(),
            timeout_ms,
            jobs
        );
        let started = Instant::now();

        let next = AtomicUsize::new(0);
        let (send, receive) = mpsc::channel();
        let mut outcomes = std::thread::scope(|scope| {
            for _ in 0..jobs {
                let send = send.clone();
                let (targets, next, solver) = (&targets, &next, &solver);
                scope.spawn(move || loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(&target) = targets.get(index) else {
                        break;
                    };
                    if send.send((index, solver.solve(target, timeout))).is_err() {
                        break;
                    }
                });
            }
            drop(send);
            receive.into_iter().collect::<Vec<_>>()
        });
        outcomes.sort_unstable_by_key(|&(index, _)| index);

        let (mut solved, mut unsolvable, mut timed_out) = (0, 0, 0);
        let mut days = BTreeMap::new();
        for (index, outcome) in outcomes {
            let target = targets[index];
            let status = match outcome? {
                Outcome::Solved(solution) => {
                    solved += 1;
                    if date.is_some() {
                        println!(
                            "{}",
                            serde_json::json!({"date": target.iso(), "placements": solution})
                        );
                    }
                    'S'
                }
                Outcome::Unsolvable => {
                    unsolvable += 1;
                    if report.is_none() {
                        println!("无解 {}（星期 {}）", target.iso(), target.weekday());
                    }
                    'U'
                }
                Outcome::TimedOut => {
                    timed_out += 1;
                    if report.is_none() {
                        println!("超时 {}（星期 {}）", target.iso(), target.weekday());
                    }
                    '?'
                }
            };
            days.entry(target.iso()[5..].to_owned()).or_insert(['?'; 7])
                [usize::from(target.weekday()) - 1] = status;
        }
        if let Some(report) = report {
            let days: BTreeMap<String, String> = days
                .into_iter()
                .map(|(day, statuses)| (day, statuses.into_iter().collect()))
                .collect();
            let contents = serde_json::to_string_pretty(&serde_json::json!({
                "reportVersion": 1,
                "boardVersion": config.board_version,
                "pieceSetVersion": config.piece_set_version,
                "statuses": { "S": "solved", "U": "unsolvable", "?": "timedOut" },
                "solved": solved,
                "unsolvable": unsolvable,
                "timedOut": timed_out,
                "days": days,
            }))
            .expect("solvability report is serializable");
            std::fs::write(&report, format!("{contents}\n"))
                .map_err(|error| format!("无法写入 {}：{error}", report.display()))?;
            println!("已写入验证报告 {}。", report.display());
        }
        println!(
            "已找到并复核 {solved}，无解 {unsolvable}，超时 {timed_out}，总耗时 {:.2} 秒。",
            started.elapsed().as_secs_f64()
        );
        Ok(solved == targets.len())
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    match native::run() {
        Ok(true) => {}
        Ok(false) => std::process::exit(1),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {}
