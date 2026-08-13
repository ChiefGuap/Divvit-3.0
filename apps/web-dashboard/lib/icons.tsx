/* Icon registry.
   The prototype inlines 24x24 stroke SVGs (stroke-width 2, round caps) — i.e.
   Lucide. The handoff says to use Lucide in the real app, so this maps the
   prototype's icon keys onto Lucide components and nothing renders raw SVG. */

import {
  Activity, BookOpen, Camera, Check, ChevronDown, ChevronLeft, ChevronRight,
  Clapperboard, CreditCard, Crown, Download, Eye, Film, Filter, Folder, Gift,
  Globe, Heart, HelpCircle, Info, LayoutGrid, Link as LinkIcon, MessageCircle,
  MessageSquare, Mic, Megaphone, MoreHorizontal, Music2, PanelLeft, Play, Plus,
  Radar, Radio, Search, Settings, Share2, Shield, SlidersHorizontal, Sparkles,
  Store, Trash2, TrendingUp, Type, Upload, Users, Video, Wand2, X, Instagram,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ICONS = {
  grid: LayoutGrid,
  clapper: Clapperboard,
  folder: Folder,
  radar: Radar,
  wand: Wand2,
  gift: Gift,
  users: Users,
  pulse: Activity,
  store: Store,
  panel: PanelLeft,
  play: Play,
  search: Search,
  sliders: SlidersHorizontal,
  settings: Settings,
  more: MoreHorizontal,
  download: Download,
  trash: Trash2,
  filter: Filter,
  globe: Globe,
  x: X,
  card: CreditCard,
  chevron: ChevronDown,
  sparkle: Sparkles,
  left: ChevronLeft,
  right: ChevronRight,
  check: Check,
  video: Video,
  eye: Eye,
  heart: Heart,
  megaphone: Megaphone,
  upload: Upload,
  shield: Shield,
  trendUp: TrendingUp,
  book: BookOpen,
  share: Share2,
  link: LinkIcon,
  info: Info,
  message: MessageCircle,
  crown: Crown,
  help: HelpCircle,
  chat: MessageSquare,
  plus: Plus,
  film: Film,
  camera: Camera,
  mic: Mic,
  type: Type,
  radio: Radio,
  tiktok: Music2,
  instagram: Instagram,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, color, style }: {
  name: IconName;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  const Cmp = ICONS[name];
  return (
    <Cmp
      size={size}
      strokeWidth={2}
      color={color}
      style={{ flex: "0 0 auto", display: "block", ...style }}
      aria-hidden
    />
  );
}
