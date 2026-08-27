import {
  TREND_DIRECTIONS, renderTrendTag,
  renderStars,
  renderRetryHealth,
  WEATHER_STATES, renderWeather,
} from '../charts/glyphs.js';

describe('renderTrendTag', () => {

  test('up renders a filled triangle', () => {
    expect(renderTrendTag('32%', 'up')).toBe('32% ▲');
  });

  test('falling renders a down-right arrow, after arbitrary label text', () => {
    expect(renderTrendTag('latency 84ms', 'falling')).toBe('latency 84ms ↘');
  });

  test('every direction in the vocabulary has a distinct glyph', () => {
    const rendered = TREND_DIRECTIONS.map(d => renderTrendTag('x', d));
    expect(new Set(rendered).size).toBe(TREND_DIRECTIONS.length);
  });

  test('down renders a filled down triangle', () => {
    expect(renderTrendTag('x', 'down')).toBe('x ▼');
  });

  test('rising renders an up-right arrow', () => {
    expect(renderTrendTag('x', 'rising')).toBe('x ↗');
  });

  test('steady renders a right arrow', () => {
    expect(renderTrendTag('x', 'steady')).toBe('x →');
  });

  test('rejects a direction outside the closed vocabulary, naming the accepted domain', () => {
    // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
    expect(() => renderTrendTag('x', 'sideways')).toThrow(RangeError);
    try {
      // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
      renderTrendTag('x', 'sideways');
    } catch (err) {
      expect((err as Error).message).toContain("'up'");
      expect((err as Error).message).toContain("'steady'");
    }
  });

});

describe('renderStars', () => {

  test('whole-star score with a default max of 5', () => {
    expect(renderStars(4, 5)).toBe('★★★★☆');
  });

  test('a genuine half-step renders the half glyph', () => {
    expect(renderStars(3.5, 5)).toBe('★★★½☆');
  });

  test('zero score is all empty', () => {
    expect(renderStars(0, 5)).toBe('☆☆☆☆☆');
  });

  test('max score is all full', () => {
    expect(renderStars(5, 5)).toBe('★★★★★');
  });

  test('max defaults to 5', () => {
    expect(renderStars(4)).toBe(renderStars(4, 5));
  });

  test('a non-half-step fraction rounds to the nearest half, up', () => {
    // 3.3 is closer to 3.5 than to 3.0
    expect(renderStars(3.3, 5)).toBe('★★★½☆');
  });

  test('a non-half-step fraction rounds to the nearest half, down', () => {
    // 3.1 is closer to 3.0 than to 3.5
    expect(renderStars(3.1, 5)).toBe('★★★☆☆');
  });

  test('a score above max throws RangeError naming the accepted domain', () => {
    expect(() => renderStars(6, 5)).toThrow(RangeError);
    expect(() => renderStars(6, 5)).toThrow(/0/);
  });

  test('a negative score throws RangeError', () => {
    expect(() => renderStars(-1, 5)).toThrow(RangeError);
  });

  test('a non-positive max throws RangeError', () => {
    expect(() => renderStars(1, 0)).toThrow(RangeError);
    expect(() => renderStars(1, -3)).toThrow(RangeError);
  });

  test('always returns exactly max characters (half counts as one)', () => {
    for (const score of [0, 1, 2.5, 3, 4.5, 7]) {
      const rendered = renderStars(score, 7);
      const count = [...rendered].length;
      expect(count).toBe(7);
    }
  });

});

describe('renderRetryHealth', () => {

  test('available hearts precede spent grey hearts', () => {
    expect(renderRetryHealth(3, 2)).toBe('❤️❤️❤️\u{1FA76}\u{1FA76}');
  });

  test('zero available and zero spent renders an empty string', () => {
    expect(renderRetryHealth(0, 0)).toBe('');
  });

  test('all available, none spent', () => {
    expect(renderRetryHealth(2, 0)).toBe('❤️❤️');
  });

  test('all spent, none available', () => {
    expect(renderRetryHealth(0, 2)).toBe('\u{1FA76}\u{1FA76}');
  });

  test('a negative available throws RangeError', () => {
    expect(() => renderRetryHealth(-1, 0)).toThrow(RangeError);
  });

  test('a negative spent throws RangeError', () => {
    expect(() => renderRetryHealth(0, -1)).toThrow(RangeError);
  });

  test('a non-integer count throws RangeError', () => {
    expect(() => renderRetryHealth(1.5, 0)).toThrow(RangeError);
  });

});

describe('renderWeather', () => {

  test('mixed renders the sun-behind-cloud glyph', () => {
    expect(renderWeather('mixed')).toBe('⛅');
  });

  test('recovered renders a rainbow', () => {
    expect(renderWeather('recovered')).toBe('\u{1F308}');
  });

  test('all-green renders a sun', () => {
    expect(renderWeather('all-green')).toBe('☀️');
  });

  test('every state in the vocabulary has a distinct glyph', () => {
    const rendered = WEATHER_STATES.map(s => renderWeather(s));
    expect(new Set(rendered).size).toBe(WEATHER_STATES.length);
  });

  test('rejects a state outside the closed vocabulary, naming the accepted domain', () => {
    // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
    expect(() => renderWeather('sunny')).toThrow(RangeError);
    try {
      // @ts-expect-error -- deliberately passing a bad value to exercise the runtime guard
      renderWeather('sunny');
    } catch (err) {
      expect((err as Error).message).toContain("'all-green'");
      expect((err as Error).message).toContain("'recovered'");
    }
  });

});

describe('vocabularies', () => {

  test('TREND_DIRECTIONS matches the documented order', () => {
    expect(TREND_DIRECTIONS).toEqual(['up', 'down', 'rising', 'falling', 'steady']);
  });

  test('WEATHER_STATES matches the documented order', () => {
    expect(WEATHER_STATES).toEqual([
      'all-green', 'mostly-green', 'mixed', 'failing', 'broad-failure',
      'flaky', 'crashing', 'stalled', 'recovered',
    ]);
  });

});
