export type Privacy = 'private' | 'unlisted' | 'public';

/** Who can see one of the account's playlists: the choices in a playlist's ⋯ menu (PlaylistMoreButton). */
export const PRIVACY_CHOICES: { value: Privacy; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you' },
  { value: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link' },
  { value: 'public', label: 'Public', hint: 'Anyone' },
];
