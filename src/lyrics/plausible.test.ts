import { describe, expect, it } from 'vitest';
import { line } from './model';
import { artistsAgree, lyricsFitDuration, namesAgree } from './plausible';

describe('whole words only', () => {
  it('does not take Alfa for Alfaaz', () => {
    expect(namesAgree('Alfa', 'Alfaaz - Acoustic')).toBe(false);
    expect(namesAgree('Alfaaz', 'Alfaaz - Acoustic')).toBe(true);
  });
  it('still lets a longer title carry the short one as words', () => {
    expect(namesAgree('Tum Hi Ho Aashiqui 2', 'Tum Hi Ho')).toBe(true);
  });
});

describe('artistsAgree', () => {
  it('reads run-together channel names and ignores filler words', () => {
    expect(artistsAgree('Afusic, Zoha Waseem & Ali Soomro', 'Afusic, Zoha Waseem, AliSoomroMusic')).toBe(true);
    expect(artistsAgree('Ali Soomro', 'AliSoomroMusic')).toBe(true);
    expect(artistsAgree('Sony Music', 'Some Other Music')).toBe(false);
  });
  it('can find a featured artist in the full credit line', () => {
    const credit = 'Coke Studio Dil (Coke Studio Nu.WAV) by Coke Studio & Afusic (Ft. Zoha Waseem & Ali Soomro)';
    expect(artistsAgree(credit, 'Afusic, Zoha Waseem, AliSoomroMusic')).toBe(true);
    expect(artistsAgree('Coke Studio', 'Afusic, Zoha Waseem, AliSoomroMusic')).toBe(false);
  });
  it('needs one artist in common', () => {
    expect(artistsAgree('Hamza Malik, Zain Zohaib', 'Hamza Malik')).toBe(true);
    expect(artistsAgree('Genius Russian Translations', 'Hamza Malik, Zain Zohaib, Atif Khan')).toBe(false);
  });
  it('passes when a side is empty', () => expect(artistsAgree('', 'Hamza Malik')).toBe(true));
});

describe('namesAgree', () => {
  it('accepts the same title however it is dressed', () => {
    expect(namesAgree('Tum Hi Ho', 'tum hi ho')).toBe(true);
    expect(namesAgree('Song (Remastered 2011)', 'Song')).toBe(true);
    expect(namesAgree('Song - Radio Edit', 'Song')).toBe(true);
    expect(namesAgree('Song feat. Someone', 'Song')).toBe(true);
    expect(namesAgree('Beyoncé', 'Beyonce')).toBe(true);
  });
  it('compares Bangla and Hindi titles by their words too', () => {
    expect(namesAgree('ভুলি তারে', 'ভুলি তারে')).toBe(true);
    expect(namesAgree('दिल मेरा', 'तुम हो')).toBe(false);
  });
  it('rejects a different song', () => {
    expect(namesAgree('Blinding Lights', 'Shape of You')).toBe(false);
    expect(namesAgree('Love Story (Taylor’s Version)', 'Bad Habits')).toBe(false);
  });
  it('lets a name through when either side has nothing to compare', () => {
    expect(namesAgree('', 'Song')).toBe(true);
    expect(namesAgree('Song', '()')).toBe(true);
  });
});

const timed = (...secs: number[]) => secs.map((s) => line(s * 1000, 'la la'));

describe('lyricsFitDuration', () => {
  it('accepts lyrics that end inside the song', () => expect(lyricsFitDuration(timed(10, 100, 200), 240_000)).toBe(true));
  it('rejects lyrics that run past the end', () => expect(lyricsFitDuration(timed(10, 100, 300), 200_000)).toBe(false));
  it('allows a little overrun', () => expect(lyricsFitDuration(timed(10, 100, 215), 200_000)).toBe(true));
  it('rejects lyrics that stop far too early in a long song', () => expect(lyricsFitDuration(timed(5, 30, 50), 300_000)).toBe(false));
  it('does not judge a short clip, plain lyrics or an unknown length', () => {
    expect(lyricsFitDuration(timed(5, 20), 60_000)).toBe(true);
    expect(lyricsFitDuration([line(0, 'plain'), line(0, 'plain')], 200_000)).toBe(true);
    expect(lyricsFitDuration(timed(10, 400), 0)).toBe(true);
  });
});
