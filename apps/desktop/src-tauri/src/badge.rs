//! The tray icon's count badge (R90, WP-23): a red disc in the bottom-right
//! corner of the base icon with the unread count in white - 1 to 9, then "9+".
//! Drawn straight into the RGBA buffer from a tiny built-in 3x5 digit bitmap,
//! so no image crate is needed.

/// What the tray shows over its icon. WP-30 adds the health states; until then
/// `health` is always `None` and only the count can appear.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthBadge {
    /// Reserved for WP-30 (a source failing, data stale).
    Warning,
    /// Reserved for WP-30 (the backend is down).
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Badge {
    None,
    Count(String),
    Health(HealthBadge),
}

/// R90's overlay hook: health beats count. `health` is `None` until WP-30.
pub fn tray_badge(health: Option<HealthBadge>, unread: u32) -> Badge {
    if let Some(health) = health {
        return Badge::Health(health);
    }
    match badge_text(unread) {
        Some(text) => Badge::Count(text),
        None => Badge::None,
    }
}

/// "1".."9", then "9+"; nothing for zero.
pub fn badge_text(unread: u32) -> Option<String> {
    match unread {
        0 => None,
        1..=9 => Some(unread.to_string()),
        _ => Some("9+".to_owned()),
    }
}

/// "Junction - 3 unread notifications".
pub fn tooltip(unread: u32) -> String {
    match unread {
        0 => "Junction".to_owned(),
        1 => "Junction \u{2014} 1 unread notification".to_owned(),
        n => format!("Junction \u{2014} {n} unread notifications"),
    }
}

/// 3x5 glyphs, one row per entry, the top bit of three the leftmost pixel.
fn glyph(c: char) -> Option<[u8; 5]> {
    Some(match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => return None,
    })
}

pub const BADGE_RED: [u8; 4] = [220, 38, 38, 255];
pub const BADGE_WHITE: [u8; 4] = [255, 255, 255, 255];

fn put(rgba: &mut [u8], width: u32, x: u32, y: u32, color: [u8; 4]) {
    let at = ((y * width + x) * 4) as usize;
    if let Some(pixel) = rgba.get_mut(at..at + 4) {
        pixel.copy_from_slice(&color);
    }
}

/// Draws `text` as a badge onto a `width` x `height` RGBA buffer, in place.
pub fn draw_badge(rgba: &mut [u8], width: u32, height: u32, text: &str) {
    let size = width.min(height);
    if size < 8 || rgba.len() < (width * height * 4) as usize {
        return;
    }
    // A disc a little over half the icon, in the bottom-right corner.
    let radius = (size * 30 / 100).max(4);
    let (cx, cy) = (width - radius - 1, height - radius - 1);
    for y in cy.saturating_sub(radius)..=(cy + radius).min(height - 1) {
        for x in cx.saturating_sub(radius)..=(cx + radius).min(width - 1) {
            let (dx, dy) = (x.abs_diff(cx), y.abs_diff(cy));
            if dx * dx + dy * dy <= radius * radius {
                put(rgba, width, x, y, BADGE_RED);
            }
        }
    }
    let glyphs: Vec<[u8; 5]> = text.chars().filter_map(glyph).collect();
    if glyphs.is_empty() {
        return;
    }
    let columns = glyphs.len() as u32 * 4 - 1;
    // Fit the text in about 1.4 radii of width and 1.1 of height.
    let scale = (radius * 14 / 10 / columns)
        .min(radius * 11 / 10 / 5)
        .max(1);
    let left = cx.saturating_sub(columns * scale / 2);
    let top = cy.saturating_sub(5 * scale / 2);
    for (index, rows) in glyphs.iter().enumerate() {
        let origin = left + index as u32 * 4 * scale;
        for (row, bits) in rows.iter().enumerate() {
            for column in 0..3u32 {
                if bits & (0b100 >> column) == 0 {
                    continue;
                }
                for sy in 0..scale {
                    for sx in 0..scale {
                        let x = origin + column * scale + sx;
                        let y = top + row as u32 * scale + sy;
                        if x < width && y < height {
                            put(rgba, width, x, y, BADGE_WHITE);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
        let at = ((y * width + x) * 4) as usize;
        [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]]
    }

    fn whites(rgba: &[u8]) -> usize {
        rgba.chunks(4).filter(|p| *p == BADGE_WHITE).count()
    }

    #[test]
    fn health_beats_the_count_and_zero_shows_nothing() {
        assert_eq!(tray_badge(None, 0), Badge::None);
        assert_eq!(tray_badge(None, 3), Badge::Count("3".to_owned()));
        assert_eq!(
            tray_badge(Some(HealthBadge::Error), 3),
            Badge::Health(HealthBadge::Error)
        );
        assert_eq!(
            tray_badge(Some(HealthBadge::Warning), 0),
            Badge::Health(HealthBadge::Warning)
        );
    }

    #[test]
    fn digits_then_nine_plus() {
        assert_eq!(badge_text(0), None);
        assert_eq!(badge_text(1).as_deref(), Some("1"));
        assert_eq!(badge_text(9).as_deref(), Some("9"));
        assert_eq!(badge_text(10).as_deref(), Some("9+"));
        assert_eq!(badge_text(u32::MAX).as_deref(), Some("9+"));
    }

    #[test]
    fn the_tooltip_names_the_count() {
        assert_eq!(tooltip(0), "Junction");
        assert_eq!(tooltip(1), "Junction \u{2014} 1 unread notification");
        assert_eq!(tooltip(3), "Junction \u{2014} 3 unread notifications");
    }

    #[test]
    fn every_digit_and_plus_has_a_distinct_glyph() {
        let all: Vec<[u8; 5]> = "0123456789+".chars().filter_map(glyph).collect();
        assert_eq!(all.len(), 11);
        let unique: std::collections::HashSet<[u8; 5]> = all.iter().copied().collect();
        assert_eq!(unique.len(), 11);
        assert_eq!(glyph('x'), None);
    }

    #[test]
    fn draws_a_red_disc_with_white_digits_bottom_right_only() {
        for size in [16u32, 32, 256] {
            let mut rgba = vec![0u8; (size * size * 4) as usize];
            draw_badge(&mut rgba, size, size, "3");
            // The top-left corner is the base icon, untouched.
            assert_eq!(pixel(&rgba, size, 0, 0), [0, 0, 0, 0], "size {size}");
            // The disc is there: some red pixels, and some white ones on it.
            assert!(rgba.chunks(4).any(|p| p == BADGE_RED), "size {size}");
            assert!(whites(&rgba) > 0, "size {size}");
        }
    }

    #[test]
    fn nine_plus_draws_more_than_one_digit() {
        let mut one = vec![0u8; 32 * 32 * 4];
        let mut wide = vec![0u8; 32 * 32 * 4];
        draw_badge(&mut one, 32, 32, "1");
        draw_badge(&mut wide, 32, 32, "9+");
        assert!(whites(&wide) > whites(&one));
    }

    #[test]
    fn a_tiny_or_short_buffer_is_left_alone() {
        let mut tiny = vec![0u8; 4 * 4 * 4];
        draw_badge(&mut tiny, 4, 4, "3");
        assert!(tiny.iter().all(|b| *b == 0));
        let mut short = vec![0u8; 10];
        draw_badge(&mut short, 32, 32, "3");
        assert!(short.iter().all(|b| *b == 0));
    }
}
