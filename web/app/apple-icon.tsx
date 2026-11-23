import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const AppleIcon = () =>
  new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#101116',
      }}
    >
      <svg width="132" height="132" viewBox="0 0 32 32">
        <path
          d="M6 24 11.5 15.5l4.5 4.5 4.5-9 5.5 13"
          fill="none"
          stroke="#f4f4f6"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="25.5" cy="24" r="2.4" fill="#3987e5" />
      </svg>
    </div>,
    size,
  );

export default AppleIcon;
