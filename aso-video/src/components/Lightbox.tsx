import { useEffect, useState } from 'react';

type Media = { kind: 'image' | 'video'; src: string };

let setLightbox: ((m: Media | null) => void) | null = null;

/** Open lightbox from anywhere — fire-and-forget. */
export function openLightbox(media: Media) {
  setLightbox?.(media);
}

/** Mount once at app root. Click any image/video preview → openLightbox(...). */
export function LightboxRoot() {
  const [media, setMedia] = useState<Media | null>(null);

  useEffect(() => {
    setLightbox = setMedia;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMedia(null); };
    window.addEventListener('keydown', onKey);
    return () => {
      setLightbox = null;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!media) return null;
  return (
    <div
      onClick={() => setMedia(null)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      {media.kind === 'image' ? (
        <img
          src={media.src}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain', cursor: 'default' }}
        />
      ) : (
        <video
          src={media.src}
          autoPlay
          controls
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '95vw', maxHeight: '95vh', cursor: 'default', background: '#000' }}
        />
      )}
      <button
        onClick={() => setMedia(null)}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: '#171717', color: '#fff', border: '1px solid #2a2a2a',
          padding: '8px 14px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
        }}
      >Close (Esc)</button>
    </div>
  );
}
