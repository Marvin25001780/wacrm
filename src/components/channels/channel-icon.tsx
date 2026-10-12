import type { ChannelMeta } from "@/lib/metrics/channels";

interface ChannelIconProps {
  meta: ChannelMeta;
  size?: number;
}

/**
 * Muestra el logo oficial del canal cuando existe (`meta.logoSrc`) y
 * cae al icono lucide cuando no. Se usa un <img> plano a propósito:
 * los SVG viven en /public y no queremos pasar por el optimizador de
 * next/image (requeriría `dangerouslyAllowSVG` y no aporta nada aquí).
 */
export function ChannelIcon({ meta, size = 20 }: ChannelIconProps) {
  if (meta.logoSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={meta.logoSrc}
        alt={`${meta.label} logo`}
        width={size}
        height={size}
        className="object-contain"
      />
    );
  }

  const Icon = meta.icon;
  const iconSize = size === 18 ? "size-4.5" : "size-5";
  return <Icon className={iconSize} />;
}
