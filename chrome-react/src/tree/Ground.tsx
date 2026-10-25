export function Ground({ left, right, heightScale, canvasLeft, canvasRight, bottom }: { left: number; right: number; heightScale: number; canvasLeft: number; canvasRight: number; bottom: number }) {
  const radius = (right - left) / 2
  const center = (left + right) / 2
  const edgeLeft = canvasLeft - center, edgeRight = canvasRight - center
  return <g className="living-ground" transform={`translate(${(left + right) / 2} 0) scale(1 ${heightScale})`} aria-hidden="true" pointerEvents="none">
    <path d={`M${edgeLeft} 18 C${-radius * .8} 5 ${-radius * .38} 2 -12 6
      C${radius * .3} 0 ${radius * .78} 6 ${edgeRight} 19
      L${edgeRight} ${bottom / heightScale} L${edgeLeft} ${bottom / heightScale} Z`} fill="#dce8cb" />
    {[-.83, -.6, -.33, .3, .58, .84].map((position, index) => <path key={position}
      transform={`translate(${position * radius} ${index % 2 ? 18 : 22}) scale(${index % 3 === 0 ? .75 : .9} ${index % 3 === 0 ? 1.3 : 1.55})`}
      d="M-7 0 Q-8-7-12-13 Q-3-10-1-3 Q-2-15 4-21 Q3-9 5-4 Q8-12 14-12 Q9-6 9 0 Z"
      fill={index % 2 ? '#7f9e62' : '#668c52'} />)}
  </g>
}
