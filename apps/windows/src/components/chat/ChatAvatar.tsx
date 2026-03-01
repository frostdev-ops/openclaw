import { useState } from "react";
import { Bot } from "lucide-react";

const AVATAR_COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
  "#3498db", "#9b59b6", "#e91e63", "#00bcd4", "#ff7043",
  "#7c4dff", "#00e5ff", "#76ff03", "#ff6e40", "#ea80fc",
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function ChatAvatar({
  name,
  isBot,
  imageUrl,
  accentColor,
  size = 36,
}: {
  name: string;
  isBot?: boolean;
  imageUrl?: string;
  accentColor?: string;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imageUrl && !imgFailed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="rounded-xl object-cover shrink-0 border border-white/10 shadow-[0_6px_18px_rgba(2,6,23,0.35)]"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  if (isBot) {
    return (
      <div
        className="rounded-xl shrink-0 flex items-center justify-center shadow-[0_10px_24px_rgba(2,6,23,0.35)]"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, rgba(14,165,233,0.28), rgba(99,102,241,0.24))",
          border: "1.5px solid rgba(14,165,233,0.42)",
        }}
      >
        <Bot size={size * 0.48} className="text-primary-400" />
      </div>
    );
  }

  const colorIndex = hashCode(name) % AVATAR_COLORS.length;
  const bg = accentColor || AVATAR_COLORS[colorIndex];
  const initial = name.charAt(0).toUpperCase();

  return (
    <div
      className="rounded-xl shrink-0 flex items-center justify-center font-bold text-white select-none border border-white/10 shadow-[0_8px_20px_rgba(2,6,23,0.35)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundColor: bg,
      }}
    >
      {initial}
    </div>
  );
}
