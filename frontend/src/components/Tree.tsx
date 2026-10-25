
import { useId } from 'react'

type TreeProps = {
  pruned?: Record<string, boolean>
  decorative?: boolean
}

type FoliageTone = 'calm' | 'some' | 'heavy'

type Branch = {
  id: string
  x: number
  y: number
  size: number
  tone: FoliageTone
  path: string
  stub: string
}

const BRANCHES: Branch[] = [
  {
    id: 'b1', x: 167, y: 237, size: 1.02, tone: 'calm',
    path: 'M318 330 Q249 313 166 237',
    stub: '',
  },
  {
    id: 'b2', x: 226, y: 132, size: 1.08, tone: 'calm',
    path: 'M319 299 Q270 209 226 132',
    stub: '',
  },
  {
    id: 'b5', x: 333, y: 110, size: 1.08, tone: 'calm',
    path: 'M320 296 Q329 197 333 110',
    stub: '',
  },
  {
    id: 'b7', x: 466, y: 247, size: .97, tone: 'calm',
    path: 'M321 346 Q408 326 466 247',
    stub: '',
  },
  {
    id: 'b9', x: 381, y: 183, size: .84, tone: 'calm',
    path: 'M324 315 Q358 261 381 183',
    stub: '',
  },
  {
    id: 'b3', x: 110, y: 319, size: .85, tone: 'some',
    path: 'M317 391 Q234 362 110 319',
    stub: 'M317 391 Q294 383 277 375',
  },
  {
    id: 'b4', x: 530, y: 346, size: .74, tone: 'some',
    path: 'M323 404 Q430 382 530 346',
    stub: 'M323 404 Q348 397 365 391',
  },
  {
    id: 'b6', x: 511, y: 167, size: .85, tone: 'heavy',
    path: 'M322 339 Q440 253 511 167',
    stub: 'M322 339 Q348 318 365 306',
  },
  {
    id: 'b8', x: 418, y: 79, size: .76, tone: 'heavy',
    path: 'M321 289 Q370 168 418 79',
    stub: 'M321 289 Q333 264 340 246',
  },
]

const PALETTES: Record<FoliageTone, string[]> = {
  calm: ['#87A982', '#A4C29A', '#BFD3AA', '#D1DDB6', '#749B77'],
  some: ['#D0AC69', '#E0C587', '#E8D49D', '#BF975A', '#DCC081'],
  heavy: ['#A78D75', '#BDA58D', '#CDB79F', '#92765F', '#D5C1AD'],
}

function Foliage({
  branch,
  decorative,
}: {
  branch: Branch
  decorative: boolean
}) {
  const palette = decorative ? PALETTES.calm : PALETTES[branch.tone]
  const { x, y, size } = branch

  return (
    <g
      className="storybook-tree__foliage"
      transform={`translate(${x} ${y}) scale(${size})`}
    >
      {/* Overlapping organic canopy shapes */}
      <ellipse
        cx="-27" cy="5" rx="47" ry="40"
        fill={palette[0]}
      />
      <ellipse
        cx="23" cy="11" rx="49" ry="43"
        fill={palette[1]}
      />
      <ellipse
        cx="-7" cy="-24" rx="51" ry="45"
        fill={palette[2]}
      />
      <ellipse
        cx="13" cy="-8" rx="38" ry="38"
        fill={palette[3]}
        opacity=".85"
      />
      <ellipse
        cx="-29" cy="-14" rx="29" ry="28"
        fill={palette[4]}
        opacity=".68"
      />

      {/* Small botanical highlights */}
      <circle cx="-13" cy="-38" r="4" fill="#F8ECC6" opacity=".6" />
      <circle cx="39" cy="2" r="5" fill="#F7EACA" opacity=".5" />
      <circle cx="-42" cy="17" r="3" fill="#F7EACA" opacity=".5" />
    </g>
  )
}

export default function Tree({
  pruned = {},
  decorative = false,
}: TreeProps) {
  const id = useId().replace(/:/g, '')
  const woodId = `${id}-wood`
  const groundId = `${id}-ground`

  return (
    <svg
      className={`tree storybook-tree${
        decorative ? ' storybook-tree--decorative' : ''
      }`}
      viewBox="0 0 640 520"
      role={decorative ? undefined : 'img'}
      aria-label={
        decorative
          ? undefined
          : 'Illustrated scrolling topic tree with branches that change when pruned.'
      }
      aria-hidden={decorative ? true : undefined}
    >
      <defs>
        <linearGradient id={woodId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#72543B" />
          <stop offset=".5" stopColor="#957355" />
          <stop offset="1" stopColor="#76553D" />
        </linearGradient>

        <radialGradient id={groundId}>
          <stop offset="0" stopColor="#D7DDC0" stopOpacity=".8" />
          <stop offset="1" stopColor="#E6E8D6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft garden ground */}
      <ellipse cx="320" cy="481" rx="210" ry="28" fill={`url(#${groundId})`} />
      <path
        d="M90 484 Q190 473 320 484 Q454 494 550 484"
        fill="none"
        stroke="#A9B894"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* All branches grow behind the foliage */}
      <g fill="none" strokeLinecap="round">
        {BRANCHES.map(branch => {
          const isPruned = !decorative && !!pruned[branch.id]
          const path = isPruned ? branch.stub : branch.path

          if (!path) return null

          return (
            <g key={branch.id}>
              <path
                d={path}
                stroke={`url(#${woodId})`}
                strokeWidth={branch.size * 13}
              />
              {isPruned && (
                <circle
                  cx={
                    branch.id === 'b3' ? 277
                    : branch.id === 'b4' ? 365
                    : branch.id === 'b6' ? 365
                    : 340
                  }
                  cy={
                    branch.id === 'b3' ? 375
                    : branch.id === 'b4' ? 391
                    : branch.id === 'b6' ? 306
                    : 246
                  }
                  r="6"
                  fill="#D9B890"
                  stroke="#84644B"
                  strokeWidth="2"
                />
              )}
            </g>
          )
        })}
      </g>

      {/* Main tree trunk */}
      <path
        d="M306 481
           C311 426 315 383 313 344
           C312 314 316 279 319 248
           C322 283 330 315 327 348
           C325 401 331 443 332 481
           Q319 488 306 481Z"
        fill={`url(#${woodId})`}
      />

      {/* Natural bark */}
      <path
        d="M315 469 Q318 422 318 390 M324 372 Q321 341 321 312"
        stroke="#5B422F"
        strokeWidth="2"
        opacity=".27"
        fill="none"
        strokeLinecap="round"
      />

      {/* Canopy for every unpruned branch */}
      {BRANCHES.map(branch => {
        if (!decorative && pruned[branch.id]) return null

        return (
          <Foliage
            key={branch.id}
            branch={branch}
            decorative={decorative}
          />
        )
      })}

      {/* Roots and grass */}
      <g stroke="#84674A" strokeLinecap="round" fill="none">
        <path d="M312 475 Q285 488 251 491" strokeWidth="8" />
        <path d="M327 475 Q357 489 388 493" strokeWidth="7" />
      </g>

      <g stroke="#98AD82" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M137 483q-5-14-5-24m5 24q7-13 14-17" />
        <path d="M464 486q-6-14-5-25m5 25q5-12 16-18" />
        <path d="M217 484q-5-10-13-14" />
        <path d="M505 488q5-10 12-14" />
      </g>
    </svg>
  )
}
