import editorial from '@/assets/molly-editorial-v3.png';

export function MollySetupArtwork() {
  return (
    <div aria-hidden className="relative aspect-[4/5] w-full max-w-[390px]">
      <img
        src={editorial}
        alt=""
        className="h-full w-full object-cover shadow-[0_24px_64px_-24px_#25292355]"
      />
    </div>
  );
}
