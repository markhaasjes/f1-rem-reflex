// Downloads Max Verstappen's onboard team-radio clips for the 2025 Dutch GP
// weekend from OpenF1 and saves them locally, so the app can play a clip on
// the final score screen without any runtime network calls.
//
//   public/audio/team-radio/<session>-<n>-<hhmmss>.mp3   every clip, archived
//   public/audio/radio-positive.mp3                      played on a good score
//   public/audio/radio-negative.mp3                      played on a weak score
//                                                        (NOT produced here -
//                                                        drop a file in place
//                                                        once one is found)
//
// The positive clip defaults to the race clip at 14:26 UTC - Verstappen's
// post-victory radio from his 2025 home win (the race ended ~14:26). Change
// POSITIVE_CLIP below and re-run if a different clip should be used; the
// script prints every clip it saves.
//
// Run with: node scripts/fetch-team-radio.mjs

import { mkdir, writeFile, copyFile } from 'node:fs/promises';

const OPENF1_BASE = 'https://api.openf1.org/v1';
const DRIVER_NUMBER = 1; // Max Verstappen

const SESSIONS = [
  { sessionKey: 9916, name: 'qualifying' },
  { sessionKey: 9920, name: 'race' },
];

/** Which downloaded clip becomes public/audio/radio-positive.mp3. */
const POSITIVE_CLIP = { sessionKey: 9920, index: 0 };

const AUDIO_DIR = new URL('../public/audio/', import.meta.url);
const ARCHIVE_DIR = new URL('../public/audio/team-radio/', import.meta.url);

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  await mkdir(ARCHIVE_DIR, { recursive: true });

  let positivePath = null;
  for (const session of SESSIONS) {
    const clips = await fetchJSON(
      `${OPENF1_BASE}/team_radio?session_key=${session.sessionKey}&driver_number=${DRIVER_NUMBER}`,
    );
    console.log(`${session.name} (session ${session.sessionKey}): ${clips.length} clip(s)`);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const hhmmss = new Date(clip.date).toISOString().slice(11, 19).replaceAll(':', '');
      const filename = `${session.name}-${i}-${hhmmss}.mp3`;
      const target = new URL(filename, ARCHIVE_DIR);

      const res = await fetch(clip.recording_url);
      if (!res.ok) throw new Error(`${clip.recording_url} -> HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      await writeFile(target, bytes);
      console.log(`  saved ${filename} (${(bytes.length / 1024).toFixed(0)} KB, ${clip.date})`);

      if (session.sessionKey === POSITIVE_CLIP.sessionKey && i === POSITIVE_CLIP.index) positivePath = target;
    }
  }

  if (positivePath) {
    await copyFile(positivePath, new URL('radio-positive.mp3', AUDIO_DIR));
    console.log(`\npositive clip -> public/audio/radio-positive.mp3`);
  } else {
    console.warn('\nWARNING: POSITIVE_CLIP not found among downloaded clips');
  }
  console.log('negative clip: drop a file at public/audio/radio-negative.mp3 (not fetched here)');
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
