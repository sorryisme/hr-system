const GEOLOCATION_TIMEOUT_MS = 3000 // N-9: GPS 수신 및 출퇴근 처리 3초 이내

export class GeolocationError extends Error {}

/** navigator.geolocation을 3초 타임아웃의 Promise로 감싸고, 실패 원인을 쉬운 말로 옮긴다(N-9) */
export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeolocationError('이 기기에서는 위치 확인을 할 수 없어요.'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      (error) => {
        reject(new GeolocationError(toGeolocationMessage(error)))
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    )
  })
}

function toGeolocationMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return '위치 권한이 꺼져 있어요. 설정에서 위치 권한을 켜주세요.'
    case error.TIMEOUT:
      return '위치를 확인하지 못했어요. 다시 시도해 주세요.'
    default:
      return '위치를 확인할 수 없어요. 건물 근처에서 다시 시도해 주세요.'
  }
}
