use chrono::{
    DateTime, Datelike, Duration, FixedOffset, Local, Months, NaiveDate, NaiveDateTime, NaiveTime,
    TimeZone, Utc,
};
use chrono_tz::Tz;

pub struct DtResult {
    pub title: String,
    pub subtitle: String,
}

/// Cheap pre-filter so most queries never enter the parsers below.
/// False positives are fine - each parser bails fast and we fall through to fend.
pub fn probe(query: &str) -> bool {
    let q = query.trim().to_ascii_lowercase();
    q.starts_with("now")
        || q.starts_with("today")
        || q.starts_with("tomorrow")
        || q.starts_with("time in ")
        || q.contains("until")
        || q.contains(" in ")
        || q.contains(" to ")
}

pub fn try_eval(query: &str) -> Option<DtResult> {
    try_eval_at(query, Local::now())
}

fn try_eval_at(query: &str, now: DateTime<Local>) -> Option<DtResult> {
    let q = query.trim().to_ascii_lowercase();
    relative_date(&q, now)
        .or_else(|| days_until(&q, now))
        .or_else(|| time_in(&q, now))
        .or_else(|| tz_convert(&q, now))
}

// ---- "now + 3 weeks", "today - 45 days", "tomorrow + 2 months" ----

fn relative_date(q: &str, now: DateTime<Local>) -> Option<DtResult> {
    // Normalize "now+3 weeks" -> "now + 3 weeks" before tokenizing.
    let spaced = q.replace('+', " + ").replace('-', " - ");
    let tokens: Vec<&str> = spaced.split_whitespace().collect();
    let base = match *tokens.first()? {
        "now" | "today" => now,
        "tomorrow" => now + Duration::days(1),
        _ => return None,
    };
    if tokens.len() == 1 {
        let title = base.format("%a, %b %-d %Y %H:%M").to_string();
        return Some(DtResult { title, subtitle: tokens[0].to_string() });
    }
    if tokens.len() != 4 {
        return None;
    }
    let negative = match tokens[1] {
        "+" => false,
        "-" => true,
        _ => return None,
    };
    let n: u32 = tokens[2].parse().ok()?;
    let unit = tokens[3].trim_end_matches('s');
    let result = match unit {
        "min" | "minute" => shift(base, Duration::minutes(n.into()), negative),
        "hour" | "hr" | "h" => shift(base, Duration::hours(n.into()), negative),
        "day" => shift(base, Duration::days(n.into()), negative),
        "week" => shift(base, Duration::weeks(n.into()), negative),
        "month" => {
            let m = Months::new(n);
            if negative { base.checked_sub_months(m)? } else { base.checked_add_months(m)? }
        }
        "year" => {
            let m = Months::new(n.checked_mul(12)?);
            if negative { base.checked_sub_months(m)? } else { base.checked_add_months(m)? }
        }
        _ => return None,
    };
    let time_precision = matches!(unit, "min" | "minute" | "hour" | "hr" | "h");
    let title = if time_precision {
        result.format("%a, %b %-d %Y %H:%M").to_string()
    } else {
        result.format("%a, %b %-d %Y").to_string()
    };
    let sign = if negative { "-" } else { "+" };
    Some(DtResult {
        title,
        subtitle: format!("{} {} {} {}{}", tokens[0], sign, n, unit, if n == 1 { "" } else { "s" }),
    })
}

fn shift(base: DateTime<Local>, d: Duration, negative: bool) -> DateTime<Local> {
    if negative { base - d } else { base + d }
}

// ---- "days until dec 25" ----

fn days_until(q: &str, now: DateTime<Local>) -> Option<DtResult> {
    let phrase = q.strip_prefix("days until ")?.trim();
    let today = now.date_naive();
    let target = parse_date_phrase(phrase, today)?;
    let days = (target - today).num_days();
    let title = match days {
        0 => "today".to_string(),
        d if d < 0 => format!("{} days ago", -d),
        1 => "1 day".to_string(),
        d => format!("{d} days"),
    };
    Some(DtResult {
        title,
        subtitle: format!("until {}", target.format("%a, %b %-d %Y")),
    })
}

/// "dec 25", "25 dec", "december 25", "2026-12-25", "12/25".
/// Without a year: the next occurrence from `today`.
fn parse_date_phrase(s: &str, today: NaiveDate) -> Option<NaiveDate> {
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d);
    }
    let (month, day) = if let Some((a, b)) = s.split_once('/') {
        (a.trim().parse().ok()?, b.trim().parse().ok()?)
    } else {
        let tokens: Vec<&str> = s.split_whitespace().collect();
        match tokens.as_slice() {
            [a, b] => {
                if let Some(m) = parse_month(a) {
                    (m, b.parse().ok()?)
                } else {
                    (parse_month(b)?, a.parse().ok()?)
                }
            }
            _ => return None,
        }
    };
    let this_year = NaiveDate::from_ymd_opt(today.year(), month, day)?;
    if this_year >= today {
        Some(this_year)
    } else {
        NaiveDate::from_ymd_opt(today.year() + 1, month, day)
    }
}

fn parse_month(s: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = [
        "january", "february", "march", "april", "may", "june", "july", "august", "september",
        "october", "november", "december",
    ];
    if s.len() < 3 {
        return None;
    }
    MONTHS
        .iter()
        .position(|m| m.starts_with(s))
        .map(|i| i as u32 + 1)
}

// ---- "time in tokyo", "time in utc+2" ----

fn time_in(q: &str, now: DateTime<Local>) -> Option<DtResult> {
    let place = q.strip_prefix("time in ")?.trim();
    let tz = resolve_zone(place)?;
    let (there, _abbr) = tz.render(now.with_timezone(&Utc));
    Some(DtResult {
        title: there.format("%H:%M").to_string(),
        subtitle: format!("{} · {}", tz.name(), there.format("%a, %b %-d")),
    })
}

// ---- "3pm EST in CET", "15:30 tokyo in utc", "3pm in cet",
//      "utc to utc+2", "time to utc", "now to tokyo" (no time = right now) ----

fn tz_convert(q: &str, now: DateTime<Local>) -> Option<DtResult> {
    let tokens: Vec<&str> = q.split_whitespace().collect();
    let sep = tokens.iter().position(|t| *t == "in" || *t == "to")?;
    let dst_name = tokens[sep + 1..].join(" ");
    if dst_name.is_empty() {
        return None;
    }
    let dst = resolve_zone(&dst_name)?;
    let left = &tokens[..sep];

    // A leading clock time ("3pm", "15:30") means "that time today"; its absence
    // means "right now". Each arm yields (instant, source wall-clock, src label).
    let (instant, src_wall, src_label) = match parse_time(left) {
        Some((time, used)) => {
            let src_name = left[used..].join(" ");
            let wall = time.format("%H:%M").to_string();
            if src_name.is_empty() {
                let naive = now.date_naive().and_time(time);
                let local = Local.from_local_datetime(&naive).earliest()?;
                (local.with_timezone(&Utc), wall, "local time".to_string())
            } else {
                let src = resolve_zone(&src_name)?;
                // Use today's date in the source zone so DST offsets match the day.
                let naive = src.today_naive(now).and_time(time);
                (src.from_local(naive)?, wall, src.name())
            }
        }
        None => {
            let instant = now.with_timezone(&Utc);
            match left.join(" ").as_str() {
                "" | "time" | "now" => {
                    let wall = now.format("%H:%M").to_string();
                    (instant, wall, "local time".to_string())
                }
                // A named/offset source is decorative here (the instant is "now"),
                // but an unresolvable left segment must bail so currency/unit
                // queries ("5 usd to eur", "5km to mi") fall through to fend.
                other => {
                    let src = resolve_zone(other)?;
                    let (there, _) = src.render(instant);
                    (instant, there.format("%H:%M").to_string(), src.name())
                }
            }
        }
    };

    let (converted, dst_abbr) = dst.render(instant);
    Some(DtResult {
        title: format!("{} {}", converted.format("%H:%M"), dst_abbr),
        subtitle: format!("{} {} → {}", src_wall, src_label, dst.name()),
    })
}

/// "3pm", "3 pm", "15:30", "3:30pm". Bare numbers are rejected as ambiguous
/// (would collide with currency/unit queries like "5 usd to eur").
fn parse_time(tokens: &[&str]) -> Option<(NaiveTime, usize)> {
    let first = *tokens.first()?;
    let (body, meridiem, used) = if let Some(b) = first.strip_suffix("pm") {
        (b, Some(true), 1)
    } else if let Some(b) = first.strip_suffix("am") {
        (b, Some(false), 1)
    } else if tokens.get(1) == Some(&"pm") {
        (first, Some(true), 2)
    } else if tokens.get(1) == Some(&"am") {
        (first, Some(false), 2)
    } else {
        (first, None, 1)
    };
    if body.is_empty() {
        return None;
    }
    let (h_str, m_str) = match body.split_once(':') {
        Some((h, m)) => (h, m),
        None if meridiem.is_some() => (body, "0"),
        None => return None, // bare number without am/pm or colon
    };
    let mut hour: u32 = h_str.parse().ok()?;
    let minute: u32 = m_str.parse().ok()?;
    match meridiem {
        Some(true) if hour < 12 => hour += 12,
        Some(false) if hour == 12 => hour = 0,
        _ => {}
    }
    NaiveTime::from_hms_opt(hour, minute, 0).map(|t| (t, used))
}

// ---- timezone resolution ----

/// Abbreviations map to a representative IANA zone; the offset is computed on
/// the target date, so "EST" queried in July correctly yields the EDT offset.
const TZ_ALIASES: &[(&str, &str)] = &[
    // abbreviations
    ("utc", "UTC"),
    ("gmt", "Etc/GMT"),
    ("est", "America/New_York"),
    ("edt", "America/New_York"),
    ("cst", "America/Chicago"),
    ("cdt", "America/Chicago"),
    ("mst", "America/Denver"),
    ("mdt", "America/Denver"),
    ("pst", "America/Los_Angeles"),
    ("pdt", "America/Los_Angeles"),
    ("bst", "Europe/London"),
    ("cet", "Europe/Paris"),
    ("cest", "Europe/Paris"),
    ("eet", "Europe/Helsinki"),
    ("eest", "Europe/Helsinki"),
    ("msk", "Europe/Moscow"),
    ("ist", "Asia/Kolkata"),
    ("jst", "Asia/Tokyo"),
    ("kst", "Asia/Seoul"),
    ("hkt", "Asia/Hong_Kong"),
    ("sgt", "Asia/Singapore"),
    ("aest", "Australia/Sydney"),
    ("aedt", "Australia/Sydney"),
    ("awst", "Australia/Perth"),
    ("nzst", "Pacific/Auckland"),
    ("nzdt", "Pacific/Auckland"),
    ("brt", "America/Sao_Paulo"),
    // cities
    ("tokyo", "Asia/Tokyo"),
    ("london", "Europe/London"),
    ("paris", "Europe/Paris"),
    ("berlin", "Europe/Berlin"),
    ("budapest", "Europe/Budapest"),
    ("vienna", "Europe/Vienna"),
    ("prague", "Europe/Prague"),
    ("warsaw", "Europe/Warsaw"),
    ("madrid", "Europe/Madrid"),
    ("rome", "Europe/Rome"),
    ("amsterdam", "Europe/Amsterdam"),
    ("brussels", "Europe/Brussels"),
    ("zurich", "Europe/Zurich"),
    ("geneva", "Europe/Zurich"),
    ("stockholm", "Europe/Stockholm"),
    ("oslo", "Europe/Oslo"),
    ("copenhagen", "Europe/Copenhagen"),
    ("helsinki", "Europe/Helsinki"),
    ("lisbon", "Europe/Lisbon"),
    ("dublin", "Europe/Dublin"),
    ("athens", "Europe/Athens"),
    ("istanbul", "Europe/Istanbul"),
    ("kyiv", "Europe/Kyiv"),
    ("kiev", "Europe/Kyiv"),
    ("moscow", "Europe/Moscow"),
    ("cairo", "Africa/Cairo"),
    ("tel aviv", "Asia/Jerusalem"),
    ("dubai", "Asia/Dubai"),
    ("mumbai", "Asia/Kolkata"),
    ("delhi", "Asia/Kolkata"),
    ("bangalore", "Asia/Kolkata"),
    ("singapore", "Asia/Singapore"),
    ("hong kong", "Asia/Hong_Kong"),
    ("shanghai", "Asia/Shanghai"),
    ("beijing", "Asia/Shanghai"),
    ("seoul", "Asia/Seoul"),
    ("sydney", "Australia/Sydney"),
    ("melbourne", "Australia/Melbourne"),
    ("perth", "Australia/Perth"),
    ("auckland", "Pacific/Auckland"),
    ("new york", "America/New_York"),
    ("nyc", "America/New_York"),
    ("boston", "America/New_York"),
    ("miami", "America/New_York"),
    ("atlanta", "America/New_York"),
    ("toronto", "America/Toronto"),
    ("chicago", "America/Chicago"),
    ("austin", "America/Chicago"),
    ("dallas", "America/Chicago"),
    ("houston", "America/Chicago"),
    ("mexico city", "America/Mexico_City"),
    ("denver", "America/Denver"),
    ("los angeles", "America/Los_Angeles"),
    ("la", "America/Los_Angeles"),
    ("san francisco", "America/Los_Angeles"),
    ("sf", "America/Los_Angeles"),
    ("seattle", "America/Los_Angeles"),
    ("vancouver", "America/Vancouver"),
    ("sao paulo", "America/Sao_Paulo"),
    ("buenos aires", "America/Argentina/Buenos_Aires"),
];

/// A resolved zone: either a named IANA zone (DST-aware, keeps `%Z` abbreviations
/// like `CEST`) or a fixed UTC offset (`utc+2`, `gmt+5:30`).
enum Zone {
    Named(Tz),
    Fixed(FixedOffset, String),
}

impl Zone {
    /// Display name for subtitles: the IANA name or the offset label.
    fn name(&self) -> String {
        match self {
            Zone::Named(tz) => tz.name().to_string(),
            Zone::Fixed(_, label) => label.clone(),
        }
    }

    /// Wall-clock datetime for `instant` in this zone, plus its abbreviation.
    fn render(&self, instant: DateTime<Utc>) -> (DateTime<FixedOffset>, String) {
        match self {
            Zone::Named(tz) => {
                let d = instant.with_timezone(tz);
                (d.fixed_offset(), d.format("%Z").to_string())
            }
            Zone::Fixed(off, label) => (instant.with_timezone(off), label.clone()),
        }
    }

    /// Interpret a naive wall time as local-in-this-zone, returning the instant.
    fn from_local(&self, naive: NaiveDateTime) -> Option<DateTime<Utc>> {
        match self {
            Zone::Named(tz) => tz
                .from_local_datetime(&naive)
                .earliest()
                .map(|d| d.with_timezone(&Utc)),
            Zone::Fixed(off, _) => off
                .from_local_datetime(&naive)
                .earliest()
                .map(|d| d.with_timezone(&Utc)),
        }
    }

    /// Current date in this zone (so DST offsets match the actual day).
    fn today_naive(&self, now: DateTime<Local>) -> NaiveDate {
        match self {
            Zone::Named(tz) => now.with_timezone(tz).date_naive(),
            Zone::Fixed(off, _) => now.with_timezone(off).date_naive(),
        }
    }
}

/// "utc+2", "gmt-5", "utc+5:30", "utc+0530", "utc+05". Only fires when a sign
/// follows the utc/gmt prefix; plain "utc"/"gmt" fall through to the named path.
fn parse_offset(token: &str) -> Option<Zone> {
    let lower = token.trim().to_ascii_lowercase();
    let rest = lower
        .strip_prefix("utc")
        .or_else(|| lower.strip_prefix("gmt"))?;
    let (positive, digits) = match rest.strip_prefix('+') {
        Some(d) => (true, d),
        None => (false, rest.strip_prefix('-')?),
    };
    let (h, m): (i32, i32) = if let Some((hh, mm)) = digits.split_once(':') {
        (hh.parse().ok()?, mm.parse().ok()?)
    } else if digits.len() > 2 {
        // "0530" -> 05:30
        let (hh, mm) = digits.split_at(digits.len() - 2);
        (hh.parse().ok()?, mm.parse().ok()?)
    } else {
        (digits.parse().ok()?, 0)
    };
    if h > 14 || m >= 60 {
        return None;
    }
    let sign = if positive { 1 } else { -1 };
    let off = FixedOffset::east_opt(sign * (h * 3600 + m * 60))?;
    let s = if positive { '+' } else { '-' };
    let label = if m == 0 {
        format!("UTC{s}{h}")
    } else {
        format!("UTC{s}{h}:{m:02}")
    };
    Some(Zone::Fixed(off, label))
}

fn resolve_zone(token: &str) -> Option<Zone> {
    parse_offset(token).or_else(|| resolve_tz(token).map(Zone::Named))
}

fn resolve_tz(token: &str) -> Option<Tz> {
    let t = token.trim();
    // Exact IANA name first ("Europe/Budapest", "asia/tokyo").
    if let Ok(tz) = t.parse::<Tz>() {
        return Some(tz);
    }
    let lower = t.to_ascii_lowercase();
    if let Ok(tz) = lower.replace(' ', "_").parse::<Tz>() {
        return Some(tz);
    }
    TZ_ALIASES
        .iter()
        .find(|(alias, _)| *alias == lower)
        .and_then(|(_, iana)| iana.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Wed Jul 1 2026, 14:30 local time.
    fn fixed_now() -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 7, 1, 14, 30, 0)
            .single()
            .unwrap()
    }

    fn eval(q: &str) -> Option<DtResult> {
        try_eval_at(q, fixed_now())
    }

    #[test]
    fn relative_dates() {
        assert_eq!(eval("now + 3 weeks").unwrap().title, "Wed, Jul 22 2026");
        assert_eq!(eval("today - 45 days").unwrap().title, "Sun, May 17 2026");
        assert_eq!(eval("now + 2 hours").unwrap().title, "Wed, Jul 1 2026 16:30");
        assert_eq!(eval("now + 6 months").unwrap().title, "Fri, Jan 1 2027");
        assert_eq!(eval("today + 1 year").unwrap().title, "Thu, Jul 1 2027");
        assert_eq!(eval("tomorrow + 1 day").unwrap().title, "Fri, Jul 3 2026");
        assert!(eval("now + 3 bananas").is_none());
    }

    #[test]
    fn days_until_phrases() {
        let r = eval("days until dec 25").unwrap();
        assert_eq!(r.title, "177 days");
        assert_eq!(r.subtitle, "until Fri, Dec 25 2026");
        // next-occurrence rollover: date already passed this year
        let r = eval("days until jan 1").unwrap();
        assert_eq!(r.subtitle, "until Fri, Jan 1 2027");
        assert_eq!(eval("days until 25 december").unwrap().title, "177 days");
        assert_eq!(eval("days until 2026-07-01").unwrap().title, "today");
        assert_eq!(eval("days until 12/25").unwrap().title, "177 days");
        assert!(eval("days until nonsense").is_none());
    }

    #[test]
    fn tz_conversions() {
        // DST edge: "EST" in July resolves to America/New_York which is on EDT
        // (UTC-4), so 3pm -> 21:00 CEST (UTC+2).
        let r = eval("3pm est in cet").unwrap();
        assert_eq!(r.title, "21:00 CEST");
        assert_eq!(r.subtitle, "15:00 America/New_York → Europe/Paris");
        let r = eval("15:30 tokyo in utc").unwrap();
        assert_eq!(r.title, "06:30 UTC");
        assert!(eval("3pm est in narnia").is_none());
        // bare numbers rejected: must not swallow currency queries
        assert!(eval("5 usd to eur").is_none());
        assert!(eval("5km to mi").is_none());
    }

    #[test]
    fn offset_zones() {
        // explicit time with an offset source
        let r = eval("15:30 utc+2 to jst").unwrap();
        assert_eq!(r.title, "22:30 JST");
        assert_eq!(r.subtitle, "15:30 UTC+2 → Asia/Tokyo");
        // 10:00 UTC+5:30 == 04:30 UTC
        let r = eval("10:00 utc+5:30 to utc").unwrap();
        assert_eq!(r.title, "04:30 UTC");
    }

    #[test]
    fn current_time_conversions() {
        // fixed_now() is 14:30 local. Without an explicit clock time the source
        // is "now"; assert the offset delta rather than the machine's local zone.
        let utc = eval("time to utc").unwrap();
        let plus2 = eval("time to utc+2").unwrap();
        // utc+2 wall clock is exactly 2h ahead of utc
        let hu: i32 = utc.title[..2].parse().unwrap();
        let hp: i32 = plus2.title[..2].parse().unwrap();
        assert_eq!((hp - hu).rem_euclid(24), 2);
        assert!(utc.title.ends_with("UTC"));
        assert!(plus2.title.ends_with("UTC+2"));
        assert!(utc.subtitle.contains("local time → UTC"));

        // "utc to utc+2": decorative source, instant is now
        let r = eval("utc to utc+2").unwrap();
        assert!(r.title.ends_with("UTC+2"));
        assert!(r.subtitle.ends_with("UTC → UTC+2"));

        // "now to tokyo" works without a clock time
        assert!(eval("now to tokyo").unwrap().title.ends_with("JST"));
    }

    #[test]
    fn offset_parsing() {
        assert_eq!(resolve_zone("utc+2").unwrap().name(), "UTC+2");
        assert_eq!(resolve_zone("gmt-5").unwrap().name(), "UTC-5");
        assert_eq!(resolve_zone("utc+5:30").unwrap().name(), "UTC+5:30");
        assert_eq!(resolve_zone("utc+0530").unwrap().name(), "UTC+5:30");
        assert_eq!(resolve_zone("utc+05").unwrap().name(), "UTC+5");
        // plain utc/gmt stay on the named path
        assert_eq!(resolve_zone("utc").unwrap().name(), "UTC");
        assert!(parse_offset("utc+99").is_none());
        assert!(parse_offset("utc").is_none());
        assert!(parse_offset("tokyo").is_none());
    }

    #[test]
    fn time_in_city() {
        let r = eval("time in tokyo").unwrap();
        assert!(r.subtitle.starts_with("Asia/Tokyo"));
        assert!(eval("time in nowhereville").is_none());
    }

    #[test]
    fn tz_resolution() {
        assert_eq!(resolve_tz("Europe/Budapest").unwrap().name(), "Europe/Budapest");
        assert_eq!(resolve_tz("hong kong").unwrap().name(), "Asia/Hong_Kong");
        assert_eq!(resolve_tz("PST").unwrap().name(), "America/Los_Angeles");
        assert!(resolve_tz("xyzzy").is_none());
    }

    #[test]
    fn month_parsing() {
        assert_eq!(parse_month("dec"), Some(12));
        assert_eq!(parse_month("december"), Some(12));
        assert_eq!(parse_month("ju"), None);
        assert_eq!(parse_month("mi"), None);
    }
}
