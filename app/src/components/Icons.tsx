import React from 'react';

// Props globales para los iconos
export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  color?: string;
  className?: string;
}

const BaseIcon: React.FC<Required<Pick<IconProps, 'size'>> & IconProps> = ({ size, color = "currentColor", children, ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const HomeIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </BaseIcon>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </BaseIcon>
);

export const UsersIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </BaseIcon>
);

export const AddressBookIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
  </BaseIcon>
);

export const MenuIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </BaseIcon>
);

export const LockIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </BaseIcon>
);

export const SendIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </BaseIcon>
);

export const PaperclipIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </BaseIcon>
);

export const ImageIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </BaseIcon>
);

export const VideoIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <rect width="14" height="14" x="2" y="5" rx="2" />
    <path d="m16 7 6-2v14l-6-2" />
  </BaseIcon>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </BaseIcon>
);

export const ReplyIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <polyline points="9 17 4 12 9 7" />
    <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
  </BaseIcon>
);

export const ExternalLinkIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </BaseIcon>
);

export const ArrowLeftIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </BaseIcon>
);

export const AlertTriangleIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </BaseIcon>
);

export const XIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </BaseIcon>
);

export const ShieldIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </BaseIcon>
);

// Generic Plus/Add Icon
export const PlusIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </BaseIcon>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </BaseIcon>
);

export const StarIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </BaseIcon>
);

export const EyeIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </BaseIcon>
);

export const GhostIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
  </BaseIcon>
);

export const FolderIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </BaseIcon>
);

export const MessageSquareIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </BaseIcon>
);

export const GlobeIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    <path d="M2 12h20" />
  </BaseIcon>
);

export const FlameIcon: React.FC<IconProps> = ({ size = 24, ...props }) => (
  <BaseIcon size={size} {...props}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </BaseIcon>
);
