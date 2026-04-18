const MIN_TICK = -887272;
const MAX_TICK = 887272;
const Q32 = 1n << 32n;
const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;

function mulShift(value: bigint, multiplier: bigint) {
  return (value * multiplier) >> 128n;
}

export function getSqrtRatioAtTick(tick: number) {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} is outside the supported v3 range.`);
  }

  const absTick = tick < 0 ? -tick : tick;

  let ratio = (absTick & 0x1) !== 0
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;

  if ((absTick & 0x2) !== 0) ratio = mulShift(ratio, 0xfff97272373d413259a46990580e213an);
  if ((absTick & 0x4) !== 0) ratio = mulShift(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  if ((absTick & 0x8) !== 0) ratio = mulShift(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  if ((absTick & 0x10) !== 0) ratio = mulShift(ratio, 0xffcb9843d60f6159c9db58835c926644n);
  if ((absTick & 0x20) !== 0) ratio = mulShift(ratio, 0xff973b41fa98c081472e6896dfb254c0n);
  if ((absTick & 0x40) !== 0) ratio = mulShift(ratio, 0xff2ea16466c96a3843ec78b326b52861n);
  if ((absTick & 0x80) !== 0) ratio = mulShift(ratio, 0xfe5dee046a99a2a811c461f1969c3053n);
  if ((absTick & 0x100) !== 0) ratio = mulShift(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  if ((absTick & 0x200) !== 0) ratio = mulShift(ratio, 0xf987a7253ac413176f2b074cf7815e54n);
  if ((absTick & 0x400) !== 0) ratio = mulShift(ratio, 0xf3392b0822b70005940c7a398e4b70f3n);
  if ((absTick & 0x800) !== 0) ratio = mulShift(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  if ((absTick & 0x1000) !== 0) ratio = mulShift(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  if ((absTick & 0x2000) !== 0) ratio = mulShift(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  if ((absTick & 0x4000) !== 0) ratio = mulShift(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n);
  if ((absTick & 0x8000) !== 0) ratio = mulShift(ratio, 0x31be135f97d08fd981231505542fcfa6n);
  if ((absTick & 0x10000) !== 0) ratio = mulShift(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  if ((absTick & 0x20000) !== 0) ratio = mulShift(ratio, 0x5d6af8dedb81196699c329225ee604n);
  if ((absTick & 0x40000) !== 0) ratio = mulShift(ratio, 0x2216e584f5fa1ea926041bedfe98n);
  if ((absTick & 0x80000) !== 0) ratio = mulShift(ratio, 0x48a170391f7dc42444e8fa2n);

  if (tick > 0) {
    ratio = MAX_UINT256 / ratio;
  }

  return (ratio >> 32n) + (ratio % Q32 === 0n ? 0n : 1n);
}

function getAmount0Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint) {
  const [lower, upper] = sqrtRatioAX96 > sqrtRatioBX96
    ? [sqrtRatioBX96, sqrtRatioAX96]
    : [sqrtRatioAX96, sqrtRatioBX96];

  return (((liquidity << 96n) * (upper - lower)) / upper) / lower;
}

function getAmount1Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint) {
  const [lower, upper] = sqrtRatioAX96 > sqrtRatioBX96
    ? [sqrtRatioBX96, sqrtRatioAX96]
    : [sqrtRatioAX96, sqrtRatioBX96];

  return (liquidity * (upper - lower)) / Q96;
}

export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
) {
  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);

  if (sqrtPriceX96 <= sqrtRatioAX96) {
    return {
      amount0: getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity),
      amount1: 0n,
    };
  }

  if (sqrtPriceX96 < sqrtRatioBX96) {
    return {
      amount0: getAmount0Delta(sqrtPriceX96, sqrtRatioBX96, liquidity),
      amount1: getAmount1Delta(sqrtRatioAX96, sqrtPriceX96, liquidity),
    };
  }

  return {
    amount0: 0n,
    amount1: getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity),
  };
}

export function isTickInRange(currentTick: number, tickLower: number, tickUpper: number) {
  return currentTick >= tickLower && currentTick < tickUpper;
}
