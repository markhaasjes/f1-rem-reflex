import { assetUrl } from '../lib/assetUrl';

// Side view of the car for the intro, from public/images/auto-zij.svg (the
// livery colors live in the file itself). The artwork faces right; the game
// convention is nose-left, so it renders mirrored.
export function HeroCar({ className = '' }: { className?: string }) {
  return (
    <img
      src={assetUrl('images/auto-zij.svg')}
      alt="Illustratie van de raceauto van Max Verstappen"
      className={`-scale-x-100 ${className}`}
    />
  );
}
