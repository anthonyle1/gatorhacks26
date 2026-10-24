import type { ReactNode } from 'react'

interface TreeProps {
  /** Branch ids that are pruned (drawn as a cut stub). */
  pruned: Record<string, boolean>
}

const TRUNK = '#6B4A33'
const WITHERED = '#7A6A5C'
const CUT = '#3A2A1E'

/** The tree drawing from the Website mockup. Branch ids match src/data/sample.ts. */
export default function Tree({ pruned }: TreeProps) {
  const layers: ReactNode[] = []

  // b3 K-pop live vocals (some hostility, left-middle)
  layers.push(
    pruned.b3 ? (
      <g key="b3">
        <path d="M318 370 C306 364 296 359 286 354" stroke={TRUNK} strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M280 364 L292 343" stroke={CUT} strokeWidth="3" strokeLinecap="round" />
      </g>
    ) : (
      <g key="b3">
        <path d="M318 370 C260 340 180 300 130 276" stroke={TRUNK} strokeWidth="10" fill="none" strokeLinecap="round" />
        <circle cx="118" cy="268" r="28" fill="#E3B44F" />
        <circle cx="88" cy="282" r="20" fill="#C9962E" />
        <circle cx="140" cy="246" r="20" fill="#E9C46A" />
        <circle cx="104" cy="244" r="17" fill="#C9962E" />
      </g>
    ),
  )

  // b4 Who did it better (some hostility, right-middle)
  layers.push(
    pruned.b4 ? (
      <g key="b4">
        <path d="M322 380 C334 376 344 372 354 369" stroke={TRUNK} strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M350 358 L360 380" stroke={CUT} strokeWidth="3" strokeLinecap="round" />
      </g>
    ) : (
      <g key="b4">
        <path d="M322 380 C380 360 450 338 504 318" stroke={TRUNK} strokeWidth="7" fill="none" strokeLinecap="round" />
        <circle cx="516" cy="312" r="18" fill="#E3B44F" />
        <circle cx="538" cy="322" r="13" fill="#C9962E" />
        <circle cx="500" cy="298" r="13" fill="#E9C46A" />
      </g>
    ),
  )

  // b6 Influencer drama (heavy, upper right)
  layers.push(
    pruned.b6 ? (
      <g key="b6">
        <path d="M322 330 C334 322 344 315 354 308" stroke={WITHERED} strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M346 298 L362 318" stroke={CUT} strokeWidth="3" strokeLinecap="round" />
      </g>
    ) : (
      <g key="b6">
        <path d="M322 330 C380 290 450 246 500 212" stroke={WITHERED} strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M440 254 C452 236 462 222 470 208" stroke={WITHERED} strokeWidth="4" fill="none" strokeLinecap="round" />
        <circle cx="512" cy="202" r="14" fill="#8A5A3B" />
        <circle cx="494" cy="196" r="10" fill="#A9784F" />
        <circle cx="528" cy="216" r="9" fill="#8A5A3B" />
        <circle cx="472" cy="202" r="8" fill="#A9784F" />
        <ellipse cx="548" cy="270" rx="7" ry="4" fill="#A9784F" transform="rotate(30 548 270)" />
        <ellipse cx="470" cy="300" rx="7" ry="4" fill="#8A5A3B" transform="rotate(-20 470 300)" />
        <ellipse cx="520" cy="330" rx="7" ry="4" fill="#8A5A3B" transform="rotate(15 520 330)" />
      </g>
    ),
  )

  // b8 YouTuber apologies (heavy, top right)
  layers.push(
    pruned.b8 ? (
      <g key="b8">
        <path d="M321 280 C325 270 329 262 333 254" stroke={WITHERED} strokeWidth="8" fill="none" strokeLinecap="round" />
        <path d="M322 252 L344 260" stroke={CUT} strokeWidth="3" strokeLinecap="round" />
      </g>
    ) : (
      <g key="b8">
        <path d="M321 280 C350 220 385 155 418 100" stroke={WITHERED} strokeWidth="8" fill="none" strokeLinecap="round" />
        <circle cx="424" cy="90" r="12" fill="#8A5A3B" />
        <circle cx="408" cy="86" r="9" fill="#A9784F" />
        <ellipse cx="452" cy="150" rx="7" ry="4" fill="#8A5A3B" transform="rotate(25 452 150)" />
        <ellipse cx="400" cy="190" rx="7" ry="4" fill="#A9784F" transform="rotate(-25 400 190)" />
      </g>
    ),
  )

  return (
    <svg className="tree" viewBox="0 0 640 520" role="img" aria-label="Your feed tree. Branch size shows how much you watch; leaf color shows how hostile the comments are.">
      <ellipse cx="320" cy="506" rx="230" ry="14" fill="#E3EADF" />

      {/* Always-healthy branches */}
      <path d="M318 430 C260 415 190 400 140 382" stroke={TRUNK} strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M322 440 C380 430 440 418 492 402" stroke={TRUNK} strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M318 320 C280 270 230 210 185 165" stroke={TRUNK} strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M319 270 C300 210 280 150 258 98" stroke={TRUNK} strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d="M320 255 C321 230 322 205 325 186" stroke={TRUNK} strokeWidth="4" fill="none" strokeLinecap="round" />

      {/* Trunk */}
      <path d="M320 506 C316 440 324 340 320 240" stroke={TRUNK} strokeWidth="28" fill="none" strokeLinecap="round" />

      {/* Healthy leaves */}
      <circle cx="128" cy="376" r="30" fill="#4E9A63" />
      <circle cx="96" cy="390" r="22" fill="#7DBB8B" />
      <circle cx="150" cy="352" r="22" fill="#7DBB8B" />
      <circle cx="108" cy="350" r="20" fill="#4E9A63" />
      <circle cx="160" cy="390" r="16" fill="#7DBB8B" />
      <circle cx="504" cy="396" r="20" fill="#4E9A63" />
      <circle cx="526" cy="406" r="14" fill="#7DBB8B" />
      <circle cx="490" cy="380" r="14" fill="#7DBB8B" />
      <circle cx="176" cy="150" r="32" fill="#4E9A63" />
      <circle cx="142" cy="162" r="22" fill="#7DBB8B" />
      <circle cx="200" cy="126" r="22" fill="#7DBB8B" />
      <circle cx="160" cy="118" r="20" fill="#4E9A63" />
      <circle cx="206" cy="166" r="16" fill="#7DBB8B" />
      <circle cx="252" cy="84" r="24" fill="#4E9A63" />
      <circle cx="228" cy="96" r="16" fill="#7DBB8B" />
      <circle cx="272" cy="66" r="16" fill="#7DBB8B" />
      <ellipse cx="318" cy="182" rx="9" ry="5" fill="#A8D5B2" transform="rotate(-30 318 182)" />
      <ellipse cx="333" cy="178" rx="9" ry="5" fill="#A8D5B2" transform="rotate(30 333 178)" />

      {/* Hostile branches: full when kept, a cut stub when pruned */}
      {layers}
    </svg>
  )
}
