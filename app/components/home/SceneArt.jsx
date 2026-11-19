import React from 'react'

// Hand-drawn stage art for the homepage. Each figure is a small puppet:
// limbs are stroked tubes drawn twice (ink underneath, colour on top) so the
// outline stays continuous while CSS rotates the joints between scenes.
const paint = (name) => `var(--home-art-${name})`
const INK = paint('ink')
const EDGE = 6
const SCALE = 0.92
const FLOOR = 420
// Hip heights that put a standing or a seated figure's shoes on the floor.
const STAND = FLOOR - 134.5 * SCALE
const SIT = FLOOR - 74.5 * SCALE

function Joint({ at, turn = 0, children }) {
  return (
    <g
      className="ill-joint"
      style={{
        transformOrigin: `${at[0]}px ${at[1]}px`,
        transform: `rotate(${-turn}deg)`,
      }}
    >
      {children}
    </g>
  )
}

function Tube({ o, x1, y1, x2, y2, w, c }) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeLinecap="round"
      style={{ stroke: o ? INK : c, strokeWidth: o ? w + EDGE : w }}
    />
  )
}

function Prop({ on, off = 'translateY(48px)', origin, late, children }) {
  return (
    <g
      className={`ill-prop${late ? ' ill-prop-late' : ''}`}
      data-on={on ? 'true' : 'false'}
      style={{ '--ill-off': off, transformOrigin: origin }}
    >
      {children}
    </g>
  )
}

const SHOULDER_Y = -90
const UPPER = 44
const FORE = 46

function Arm({ o, x, pose, lean, sleeve, skin, children }) {
  const [shoulder, elbow] = pose
  const elbowY = SHOULDER_Y + UPPER
  const wristY = elbowY + FORE
  return (
    <Joint at={[x, SHOULDER_Y]} turn={shoulder}>
      <Tube o={o} x1={x} y1={SHOULDER_Y} x2={x} y2={elbowY} w={18} c={sleeve} />
      <Joint at={[x, elbowY]} turn={elbow}>
        <Tube
          o={o}
          x1={x}
          y1={elbowY}
          x2={x}
          y2={wristY - 4}
          w={18}
          c={sleeve}
        />
        {!o && (
          <>
            {children && (
              <g transform={`translate(${x} ${wristY + 4})`}>
                {/* Counter-rotate so whatever is held stays upright. */}
                <Joint at={[0, 0]} turn={-(shoulder + elbow + lean)}>
                  {children}
                </Joint>
              </g>
            )}
            <circle
              className="ill-shape"
              cx={x}
              cy={wristY + 4}
              r="9"
              style={{ fill: skin }}
            />
          </>
        )}
      </Joint>
    </Joint>
  )
}

function Leg({ o, x, pose, c, shoe }) {
  const [hip, knee] = pose
  return (
    <Joint at={[x, 0]} turn={hip}>
      <Tube o={o} x1={x} y1={0} x2={x} y2={60} w={24} c={c} />
      <Joint at={[x, 60]} turn={-knee}>
        <Tube o={o} x1={x} y1={60} x2={x} y2={112} w={24} c={c} />
        {!o && (
          <path
            className="ill-shape"
            d={`M${x - 13},118 h20 q16,0 16,11 v4 h-36 z`}
            style={{ fill: shoe }}
          />
        )}
      </Joint>
    </Joint>
  )
}

const HAIR = {
  bun: (
    <>
      <circle className="ill-shape i-hair" cx="-16" cy="-162" r="10" />
      <path
        className="ill-shape i-hair"
        d="M-22,-126 C-34,-150 -20,-167 2,-165 C22,-165 31,-152 28,-139 C18,-152 4,-154 -4,-146 C-8,-136 -8,-124 -12,-112 C-20,-110 -24,-116 -22,-126 Z"
      />
    </>
  ),
  waiter: (
    <>
      <path
        className="ill-shape i-hair"
        d="M-8,-159 C-27,-152 -28,-124 -17,-109 C-13,-112 -12,-118 -13,-126 C-17,-137 -13,-148 -3,-156 Z"
      />
      <path
        className="i-face"
        d="M5,-122 C9,-128 14,-126 15,-124 C17,-127 23,-128 26,-122 C21,-119 17,-120 15,-121 C13,-119 9,-119 5,-122 Z"
      />
    </>
  ),
  curls: (
    <>
      {[
        [-19, -142, 9],
        [-14, -154, 10],
        [0, -161, 11],
        [14, -157, 10],
        [24, -147, 7],
      ].map(([cx, cy, r]) => (
        <circle
          key={cx}
          className="ill-shape i-hair-warm"
          cx={cx}
          cy={cy}
          r={r}
        />
      ))}
      <path
        className="i-hair-warm"
        d="M-22,-146 L0,-166 L26,-150 L18,-146 L-10,-144 Z"
      />
      <path
        className="ill-line"
        d="M3,-136 a6,6 0 1 0 12,0 a6,6 0 1 0 -12,0 M17,-136 a6,6 0 1 0 12,0 a6,6 0 1 0 -12,0 M15,-136 h2"
        style={{ strokeWidth: 2 }}
      />
    </>
  ),
}

function Head({ look, headphones }) {
  return (
    <>
      <rect
        className="ill-shape"
        x="-7"
        y="-116"
        width="14"
        height="20"
        style={{ fill: look.skin }}
      />
      <ellipse
        className="ill-shape"
        cx="2"
        cy="-134"
        rx="24"
        ry="26"
        style={{ fill: look.skin }}
      />
      {look.blush && <circle className="i-blush" cx="3" cy="-126" r="4" />}
      {look.hair !== 'curls' && (
        <>
          <circle className="i-face" cx="9" cy="-137" r="2.2" />
          <circle className="i-face" cx="21" cy="-137" r="2.2" />
        </>
      )}
      <path className="ill-line ill-thin" d="M16,-133 q4,5 -1,8" />
      {look.hair !== 'waiter' && (
        <path className="ill-line ill-thin" d="M8,-120 q6,5 13,0" />
      )}
      {HAIR[look.hair]}
      {headphones !== undefined && (
        <Prop on={headphones} off="translateY(-36px)">
          <path
            className="ill-line"
            d="M-8,-140 C-12,-178 28,-180 28,-150"
            style={{ strokeWidth: 9 }}
          />
          <path
            className="ill-line"
            d="M-8,-140 C-12,-178 28,-180 28,-150"
            style={{ stroke: paint('rose'), strokeWidth: 4 }}
          />
          <rect
            className="ill-shape i-rose"
            x="-17"
            y="-146"
            width="17"
            height="26"
            rx="8"
          />
        </Prop>
      )}
    </>
  )
}

function Person({ look, pose, flip, wear, holdA, holdB, headphones }) {
  const { at, lean = 0, head = 0, a, b, legs } = pose
  const arm = { lean, sleeve: look.top, skin: look.skin }
  return (
    <g
      className="ill-move"
      style={{ transform: `translate(${at[0]}px, ${at[1]}px)` }}
    >
      <g
        className="ill-person"
        transform={`scale(${flip ? -SCALE : SCALE} ${SCALE})`}
      >
        {[
          [-11, legs[0]],
          [11, legs[1]],
        ].map(([x, legPose]) => (
          <React.Fragment key={x}>
            <Leg o x={x} pose={legPose} />
            <Leg x={x} pose={legPose} c={look.legs} shoe={look.shoe} />
          </React.Fragment>
        ))}
        <Joint at={[0, 0]} turn={lean}>
          <path
            className="ill-shape"
            d="M-22,-99 C-27,-98 -29,-92 -29,-84 L-31,3 C-18,11 18,11 31,3 L29,-84 C29,-92 27,-98 22,-99 Z"
            style={{ fill: look.top }}
          />
          <path className="ill-line ill-thin" d="M-10,-99 Q0,-89 10,-99" />
          {wear}
          <Joint at={[0, -104]} turn={head}>
            <Head look={look} headphones={headphones} />
          </Joint>
          <Arm o x={-21} pose={a} {...arm} />
          <Arm x={-21} pose={a} {...arm}>
            {holdA}
          </Arm>
          <Arm o x={21} pose={b} {...arm} />
          <Arm x={21} pose={b} {...arm}>
            {holdB}
          </Arm>
        </Joint>
      </g>
    </g>
  )
}

function Card({ x = 0, y = 0, turn = 0, tone = 'paper', w = 40, h = 52 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect className={`ill-shape i-${tone}`} width={w} height={h} rx="2" />
      <path
        className="ill-line"
        d={`M8,14 H${w - 8}`}
        style={{ stroke: paint('rose'), strokeWidth: 3.5 }}
      />
      <path
        className="ill-line ill-thin"
        d={`M8,26 H${w - 12} M8,36 H${w - 18}`}
      />
    </g>
  )
}

function Bubble({ d, lines, accent }) {
  return (
    <>
      <path className="ill-shape i-paper" d={d} />
      <path className="ill-line" d={lines} />
      {accent && (
        <path
          className="ill-line"
          d={accent}
          style={{ stroke: paint('rose') }}
        />
      )}
    </>
  )
}

const PARTNER = {
  skin: paint('skin-b'),
  top: paint('pine'),
  legs: paint('ochre'),
  shoe: paint('sage'),
  hair: 'waiter',
}
const COHOST = {
  skin: paint('skin-c'),
  top: paint('rose'),
  legs: paint('pine'),
  shoe: paint('ochre'),
  hair: 'curls',
  blush: true,
}
const LEARNER = {
  skin: paint('skin-a'),
  top: paint('blush'),
  legs: 'url(#ill-stripes)',
  shoe: paint('rose'),
  hair: 'bun',
  blush: true,
}

const LEGS_STANDING = [
  [-3, 0],
  [4, 0],
]
const LEGS_SEATED = [
  [90, 90],
  [86, 87],
]
const LEGS_AT_DESK = [
  [30, 60],
  [20, 50],
]
// Arms are [shoulder, elbow] in degrees, measured forward from hanging down.
const PARTNER_POSES = [
  { at: [286, STAND], a: [60, 55], b: [35, 95], legs: LEGS_STANDING },
  {
    at: [262, 326],
    lean: 3,
    head: -3,
    a: [10, 80],
    b: [55, 110],
    legs: LEGS_AT_DESK,
  },
  { at: [244, STAND], head: 5, a: [15, 100], b: [78, 12], legs: LEGS_STANDING },
]
const COHOST_POSE = {
  at: [130, 326],
  a: [-145, -25],
  b: [20, 75],
  legs: LEGS_AT_DESK,
}
const LEARNER_POSES = [
  { at: [286, SIT], a: [15, 50], b: [50, 100], legs: LEGS_SEATED },
  {
    at: [250, STAND],
    lean: -3,
    head: -8,
    a: [-160, -15],
    b: [25, 108],
    legs: LEGS_STANDING,
  },
  {
    at: [272, STAND - 36],
    lean: 4,
    head: -14,
    a: [20, 75],
    b: [138, 16],
    legs: LEGS_STANDING,
  },
]

function Frame({ children, side }) {
  return (
    <svg
      viewBox="0 0 400 422"
      className={`home-art home-art-${side}`}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/* The partner side: a waiter for role-play, two hosts for the podcast,
   and someone handing over phrase cards for the vocabulary book. */
export function PartnerArt({ scene }) {
  return (
    <Frame side="partner">
      <Prop on={scene === 0} off="translateX(-140px)">
        <path
          className="ill-shape i-sage"
          d="M72,372 C50,350 28,328 30,296 C56,308 68,340 72,372 Z M76,372 C60,330 52,298 72,264 C92,298 90,336 76,372 Z M80,372 C94,346 114,330 124,302 C130,336 106,360 80,372 Z"
        />
        <path
          className="ill-line ill-thin"
          d="M72,372 Q54,338 40,312 M76,372 Q70,320 72,286 M80,372 Q104,344 118,318"
        />
        <path className="ill-shape i-rose" d="M50,372 H102 L95,420 H57 Z" />
      </Prop>
      <Prop on={scene === 0} late>
        <path
          className="ill-line ill-wire"
          d="M162,420 L174,336 M218,420 L206,336"
          style={{ strokeWidth: 4 }}
        />
        <rect
          className="ill-shape i-pine"
          x="160"
          y="330"
          width="60"
          height="62"
          rx="2"
        />
        <path
          className="ill-line ill-thin"
          d="M172,346 H206 M172,358 H198 M172,370 H204"
          style={{ stroke: paint('paper') }}
        />
      </Prop>

      <Prop on={scene === 1} off="translateX(-240px)" late>
        <Person look={COHOST} pose={COHOST_POSE} headphones={scene === 1} />
      </Prop>
      <Person
        look={PARTNER}
        pose={PARTNER_POSES[scene]}
        headphones={scene === 1}
        wear={
          <>
            <path
              className="ill-shape i-rose"
              d="M0,-100 L-12,-107 V-93 Z M0,-100 L12,-107 V-93 Z"
            />
            <Prop on={scene === 0} off="translateY(-18px)">
              <path
                className="ill-line ill-thin"
                d="M-12,-66 L-8,-97 M12,-66 L8,-97"
              />
              <path
                className="ill-shape i-paper"
                d="M-14,-68 H14 L16,-28 L29,-26 L31,42 Q0,50 -31,42 L-29,-26 L-16,-28 Z"
              />
              <path className="ill-line ill-thin" d="M-12,2 H12 V20 H-12 Z" />
            </Prop>
          </>
        }
        holdA={
          <>
            <Prop on={scene === 0} off="scale(.3)">
              <path
                className="ill-line"
                d="M-4,8 L10,-20"
                style={{ strokeWidth: 6 }}
              />
              <path
                className="ill-line"
                d="M-4,8 L10,-20"
                style={{ stroke: paint('rose'), strokeWidth: 2.5 }}
              />
            </Prop>
            <Prop on={scene === 2} off="scale(.3)" late>
              <Card x={-4} y={-34} turn={8} tone="blush" w={34} h={44} />
              <Card x={-8} y={-38} turn={-4} w={34} h={44} />
            </Prop>
          </>
        }
        holdB={
          <>
            <Prop on={scene === 0} off="scale(.3)">
              <rect
                className="ill-shape i-paper"
                x="-8"
                y="-34"
                width="30"
                height="40"
                rx="2"
              />
              <path
                className="ill-line ill-thin"
                d="M-1,-24 H15 M-1,-16 H11 M-1,-8 H13"
              />
            </Prop>
            <Prop on={scene === 2} off="scale(.3)" late>
              <Card x={-6} y={-50} turn={6} w={46} h={58} />
            </Prop>
          </>
        }
      />

      <Prop on={scene === 0} off="scale(.4)" origin="252px 136px" late>
        <Bubble
          d="M142,44 H238 a14,14 0 0 1 14,14 V94 a14,14 0 0 1 -14,14 H234 L252,136 L210,108 H142 a14,14 0 0 1 -14,-14 V58 a14,14 0 0 1 14,-14 Z"
          lines="M146,66 H232 M146,84 H204"
        />
      </Prop>

      <Prop on={scene === 1} off="translateY(130px)">
        <rect
          className="ill-shape i-mist"
          x="62"
          y="330"
          width="276"
          height="96"
        />
        <path
          className="ill-line ill-thin"
          d="M92,352 H308 V426 M92,352 V426"
        />
        <rect
          className="ill-shape i-ochre"
          x="48"
          y="318"
          width="304"
          height="14"
          rx="2"
        />
        {[178, 312].map((x) => (
          <g key={x}>
            <path
              className="ill-line ill-wire"
              d={`M${x},318 V270`}
              style={{ strokeWidth: 4 }}
            />
            <path
              className="ill-shape i-pine"
              d={`M${x - 14},318 q14,-10 28,0 Z`}
            />
            <rect
              className="ill-shape i-sage"
              x={x - 9}
              y="230"
              width="18"
              height="40"
              rx="9"
            />
            <path
              className="ill-line ill-thin"
              d={`M${x - 8},244 h16 M${x - 8},252 h16`}
            />
          </g>
        ))}
      </Prop>
      <Prop on={scene === 1} off="translateY(-90px)" late>
        <path
          className="ill-line ill-thin ill-wire"
          d="M172,0 V30 M228,0 V30"
        />
        <rect
          className="ill-shape i-rose"
          x="148"
          y="30"
          width="104"
          height="38"
          rx="2"
        />
        <circle className="ill-blink i-paper" cx="168" cy="49" r="6" />
        <path
          className="ill-line"
          d="M184,43 H234 M184,55 H220"
          style={{ stroke: paint('paper'), strokeWidth: 3.5 }}
        />
      </Prop>
      <Prop on={scene === 1} off="translateX(-16px)" late>
        <path
          className="ill-line ill-wave"
          d="M336,226 q10,14 0,28"
          style={{ stroke: paint('rose') }}
        />
        <path
          className="ill-line ill-wave ill-wave-2"
          d="M350,216 q18,24 0,48"
          style={{ stroke: paint('rose') }}
        />
        <path
          className="ill-line ill-wave ill-wave-3"
          d="M366,206 q26,34 0,68"
          style={{ stroke: paint('rose') }}
        />
      </Prop>

      <Prop on={scene === 2} off="translateX(-180px)">
        <path
          className="ill-line ill-wire"
          d="M84,366 L78,420 M160,366 L166,420"
          style={{ strokeWidth: 4 }}
        />
        <rect
          className="ill-shape i-pine"
          x="68"
          y="356"
          width="108"
          height="12"
          rx="2"
        />
        <Card x={88} y={286} turn={-8} w={30} h={44} />
        <Card x={112} y={278} turn={3} tone="blush" w={30} h={48} />
        <Card x={134} y={290} turn={10} w={28} h={40} />
        <rect
          className="ill-shape i-ochre"
          x="78"
          y="314"
          width="88"
          height="42"
          rx="2"
        />
        <path className="ill-shape i-paper" d="M108,328 H136 V340 H108 Z" />
      </Prop>
      <Prop
        on={scene === 2}
        off="translate(-40px, 50px) scale(.5)"
        origin="200px 220px"
        late
      >
        <path
          className="ill-line ill-thin ill-wire"
          d="M140,272 C140,220 160,170 196,150"
          strokeDasharray="2 8"
        />
        <Card x={132} y={204} turn={-16} tone="blush" w={30} h={40} />
        <Card x={176} y={120} turn={12} w={30} h={40} />
      </Prop>
    </Frame>
  )
}

function Cat({ scene }) {
  const at = [
    [54, 420],
    [150, 420],
    [118, 420],
  ][scene]
  return (
    <g
      className="ill-move"
      style={{ transform: `translate(${at[0]}px, ${at[1]}px)` }}
    >
      <g className="ill-person" transform="scale(.9)">
        <Joint at={[-22, -6]} turn={[0, -50, 20][scene]}>
          <path
            className="ill-line"
            d="M-22,-6 C-48,-4 -54,-30 -42,-44"
            style={{ strokeWidth: 15 }}
          />
          <path
            className="ill-line"
            d="M-22,-6 C-48,-4 -54,-30 -42,-44"
            style={{ stroke: paint('ochre'), strokeWidth: 9 }}
          />
        </Joint>
        <path
          className="ill-shape i-ochre"
          d="M-26,0 C-36,-30 -22,-60 0,-60 C18,-60 26,-36 24,0 Z"
        />
        <path
          className="ill-line ill-thin"
          d="M-20,-34 q6,2 10,-2 M-16,-22 q6,2 10,-2"
        />
        <Joint at={[12, -26]} turn={[0, 0, 150][scene]}>
          <Tube o x1={12} y1={-26} x2={12} y2={-5} w={10} />
          <Tube x1={12} y1={-26} x2={12} y2={-5} w={10} c={paint('ochre')} />
        </Joint>
        <Joint at={[6, -58]} turn={[0, 6, 26][scene]}>
          <path
            className="ill-shape i-ochre"
            d="M-8,-78 L-6,-98 L8,-86 Z M14,-86 L28,-98 L28,-76 Z"
          />
          <circle className="ill-shape i-ochre" cx="10" cy="-70" r="19" />
          <circle className="i-face" cx="6" cy="-72" r="2" />
          <circle className="i-face" cx="19" cy="-72" r="2" />
          <path className="i-rose" d="M10,-66 h6 l-3,4 Z" />
          <path
            className="ill-line ill-thin"
            d="M22,-64 h12 M22,-60 l11,3"
            style={{ strokeWidth: 1.5 }}
          />
        </Joint>
      </g>
    </g>
  )
}

/* The learner side: at a café table, out with headphones as the sun
   comes up, then pegging the phrases worth keeping onto a line. */
export function LearnerArt({ scene }) {
  return (
    <Frame side="learner">
      <defs>
        <pattern
          id="ill-stripes"
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
        >
          <rect width="12" height="12" className="i-mist" />
          <rect width="12" height="5" className="i-pine" />
        </pattern>
      </defs>

      <Prop on={scene === 1} off="translateY(170px)">
        <circle className="ill-shape i-sun" cx="118" cy="388" r="92" />
        <path
          className="ill-line ill-rays"
          d="M118,270 V246 M52,296 L36,278 M184,296 L200,278 M10,348 L-12,340"
          style={{ stroke: paint('ochre'), strokeWidth: 4 }}
        />
      </Prop>
      <Prop on={scene === 1} off="translateX(-140px)" late>
        <path
          className="ill-shape i-paper"
          d="M40,96 a16,16 0 0 1 22,-18 a22,22 0 0 1 40,2 a15,15 0 0 1 8,28 H46 a10,10 0 0 1 -6,-12 Z"
        />
      </Prop>

      <Prop on={scene === 0} off="translateY(-130px)">
        <path className="ill-line ill-thin ill-wire" d="M152,0 V70" />
        <path
          className="ill-shape i-pine"
          d="M124,106 L146,68 H158 L180,106 Z"
        />
        <path className="ill-shape i-ochre" d="M142,106 a10,9 0 0 0 20,0 Z" />
      </Prop>
      <Prop on={scene === 0} off="translateX(150px)">
        <path
          className="ill-line ill-wire"
          d="M270,372 L266,420 M324,372 L330,420"
          style={{ strokeWidth: 5 }}
        />
        <path
          className="ill-line"
          d="M324,368 C328,330 328,300 322,272"
          style={{ strokeWidth: 12 }}
        />
        <path
          className="ill-line"
          d="M324,368 C328,330 328,300 322,272"
          style={{ stroke: paint('pine'), strokeWidth: 6 }}
        />
        <rect
          className="ill-shape i-pine"
          x="258"
          y="364"
          width="76"
          height="11"
          rx="3"
        />
      </Prop>

      <Prop on={scene === 2} off="translateY(60px)" late>
        <path
          className="ill-line ill-wire"
          d="M248,392 L242,420 M296,392 L302,420 M246,408 H298"
          style={{ strokeWidth: 5 }}
        />
        <rect
          className="ill-shape i-ochre"
          x="236"
          y="384"
          width="72"
          height="10"
          rx="2"
        />
      </Prop>

      <Cat scene={scene} />

      <Person
        look={LEARNER}
        pose={LEARNER_POSES[scene]}
        flip
        headphones={scene === 1}
        holdA={
          <Prop on={scene === 2} off="scale(.3)" late>
            <Card x={-12} y={-30} turn={-10} tone="blush" w={30} h={40} />
            <Card x={-6} y={-32} turn={4} w={30} h={40} />
          </Prop>
        }
        holdB={
          <Prop on={scene === 1} off="scale(.3)" late>
            <path className="ill-line" d="M12,-12 q12,2 2,14" />
            <rect
              className="ill-shape i-paper"
              x="-8"
              y="-18"
              width="22"
              height="24"
              rx="3"
            />
            <path
              className="ill-line ill-thin ill-steam ill-wire"
              d="M0,-24 q-5,-7 0,-13 q5,-6 0,-12"
            />
          </Prop>
        }
      />

      <Prop on={scene === 0} off="translateY(140px)">
        <path
          className="ill-line"
          d="M160,335 V414"
          style={{ strokeWidth: 12 }}
        />
        <path
          className="ill-line"
          d="M160,335 V414"
          style={{ stroke: paint('ochre'), strokeWidth: 6 }}
        />
        <path className="ill-shape i-ochre" d="M130,420 q30,-18 60,0 Z" />
        <rect
          className="ill-shape i-ochre"
          x="102"
          y="324"
          width="116"
          height="11"
          rx="3"
        />
        <path className="ill-line" d="M196,310 q13,2 2,12" />
        <rect
          className="ill-shape i-paper"
          x="176"
          y="302"
          width="22"
          height="22"
          rx="3"
        />
        <path
          className="ill-line ill-thin ill-steam ill-wire"
          d="M187,294 q-5,-7 0,-13 q5,-6 0,-12"
        />
        <path
          className="ill-line ill-thin"
          d="M130,300 C128,286 132,276 128,264"
        />
        <circle className="ill-shape i-rose" cx="128" cy="258" r="8" />
        <rect
          className="ill-shape i-blush"
          x="120"
          y="300"
          width="18"
          height="24"
          rx="3"
        />
      </Prop>
      <Prop on={scene === 0} off="scale(.4)" origin="246px 212px" late>
        <Bubble
          d="M104,132 H206 a14,14 0 0 1 14,14 V174 a14,14 0 0 1 -14,14 H216 L246,212 L196,188 H104 a14,14 0 0 1 -14,-14 V146 a14,14 0 0 1 14,-14 Z"
          lines="M108,152 H200"
          accent="M108,170 H172"
        />
      </Prop>

      <Prop
        on={scene === 1}
        off="translate(30px, 30px) scale(.4)"
        origin="200px 170px"
        late
      >
        <g className="ill-note">
          <path className="ill-line ill-wire" d="M206,140 V114 l14,-4 V134" />
          <ellipse
            className="ill-shape i-rose"
            cx="200"
            cy="141"
            rx="7"
            ry="5"
          />
          <ellipse
            className="ill-shape i-rose"
            cx="214"
            cy="135"
            rx="7"
            ry="5"
          />
        </g>
        <g className="ill-note ill-note-2">
          <path className="ill-line ill-wire" d="M172,92 V70" />
          <ellipse
            className="ill-shape i-rose"
            cx="166"
            cy="93"
            rx="7"
            ry="5"
          />
        </g>
      </Prop>

      <Prop on={scene === 2} off="translateY(-150px)">
        <path
          className="ill-line ill-thin ill-wire"
          d="M0,88 Q200,118 400,70"
        />
        {[
          [42, 97, -5, 'paper'],
          [122, 101, 4, 'blush'],
        ].map(([x, y, turn, tone]) => (
          <g
            key={x}
            className="ill-swing"
            style={{ transformOrigin: `${x + 20}px ${y}px` }}
          >
            <Card x={x} y={y} turn={turn} tone={tone} />
            <rect
              className="ill-shape i-rose"
              x={x + 16}
              y={y - 8}
              width="8"
              height="16"
              rx="2"
            />
          </g>
        ))}
      </Prop>
      <Prop
        on={scene === 2}
        off="translate(40px, 80px) scale(.5)"
        origin="204px 100px"
        late
      >
        <Card x={184} y={100} turn={-3} />
        <rect
          className="ill-shape i-rose"
          x="200"
          y="92"
          width="8"
          height="16"
          rx="2"
        />
      </Prop>
    </Frame>
  )
}
