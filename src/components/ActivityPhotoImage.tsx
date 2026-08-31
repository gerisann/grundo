import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { useInView } from '@/hooks/useInView';
import { api } from '@/lib/api';

interface ActivityPhotoImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  activityId: string;
  path: string;
  /** A képnézegetőben nem várunk görgetési láthatóságra. */
  loadImmediately?: boolean;
}

/**
 * Aktivitásfotó hitelesített betöltése rövid életű, lokális blob URL-be.
 *
 * Az Authorization fejléc miatt egy sima `<img src>` nem használható. A
 * feedben csak a képernyő közelébe érő képet kérjük le; a blob URL-t pedig
 * komponensváltáskor visszavonjuk, hogy a hosszú feed ne tartsa memóriában.
 */
export function ActivityPhotoImage({
  activityId,
  path,
  loadImmediately = false,
  alt = '',
  ...imageProps
}: ActivityPhotoImageProps) {
  const { ref, inView } = useInView<HTMLImageElement>({ rootMargin: '400px' });
  const [source, setSource] = useState<string>();

  useEffect(() => {
    if (!loadImmediately && !inView) return;

    const controller = new AbortController();
    let objectUrl: string | undefined;
    setSource(undefined);
    void api.activityPhoto(activityId, path, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSource(undefined);
      }
    });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activityId, inView, loadImmediately, path]);

  return <img ref={ref} src={source} alt={alt} {...imageProps} />;
}
