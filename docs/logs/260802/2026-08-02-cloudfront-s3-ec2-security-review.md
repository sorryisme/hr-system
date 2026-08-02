# CloudFront-S3 프론트엔드 및 EC2 백엔드 보안 검토

- 검토일: 2026-08-02
- 대상: `apps/web` Vite/React 프론트엔드, `apps/api` NestJS 백엔드
- 검토 범위: CloudFront-S3 프론트엔드와 EC2 백엔드 배포 구조
- 변경 사항: 진단 문서만 작성했으며 애플리케이션 및 AWS 인프라 설정은 변경하지 않음

## 1. 결론

CloudFront-S3 프론트엔드와 EC2 백엔드 구성은 가능하다. 다만 EC2에 공인 IP를 부여하고 애플리케이션 포트 또는 SSH를 인터넷에 직접 공개하는 구성은 안전하다고 보기 어렵다.

승인 가능한 권장 구조는 다음과 같다.

```text
사용자
  │ HTTPS
  ▼
CloudFront + AWS WAF
  ├─ /*       → 비공개 S3 버킷(OAC)
  └─ /api/*   → ALB(HTTPS)
                    │
                    ▼
             Private Subnet EC2
                    │
                    ▼
             Private Subnet RDS
```

핵심 판단은 다음과 같다.

- CloudFront와 비공개 S3를 OAC로 연결하는 방식은 적절하다.
- EC2는 직접 공개하지 않고 ALB 뒤 Private Subnet에 배치해야 한다.
- CloudFront를 우회해 ALB에 직접 접근하지 못하도록 네트워크 및 애플리케이션 계층을 함께 제한해야 한다.
- 현재 저장소에는 Terraform 또는 실제 AWS 리소스 설정이 없으므로 보안 통제의 적용 여부를 확정할 수 없다.
- 확정 아키텍처 문서는 ECS/Fargate를 전제로 하므로 EC2로 변경할 경우 운영 패치, AMI, SSM, Auto Scaling 책임을 별도로 반영해야 한다.

## 2. 주요 보안 이슈

| 우선순위 | 이슈 | 판단 및 대응 |
|---|---|---|
| Critical | EC2 직접 공개 | EC2 공인 IP를 제거하고 3000, 80, 443, 22번 포트를 `0.0.0.0/0`에 열지 않는다. Private Subnet에 배치하고 ALB 보안그룹에서만 애플리케이션 포트 접근을 허용한다. |
| Critical | DB 외부 노출 | RDS Public Access를 비활성화하고 EC2 보안그룹에서만 3306 접근을 허용한다. DB 자격 증명은 Secrets Manager 또는 SSM Parameter Store에 저장한다. |
| High | CloudFront 우회 | ALB 보안그룹에서 CloudFront origin-facing managed prefix list만 허용하고, CloudFront가 추가하는 충분히 긴 비밀 헤더를 ALB listener rule에서 검증한다. |
| High | S3 직접 접근 | S3 정적 웹사이트 엔드포인트를 사용하지 않는다. REST origin과 OAC를 사용하고 Block Public Access를 모두 활성화하며, 특정 CloudFront distribution만 버킷 정책에서 허용한다. |
| High | 인증 아키텍처 불일치 | 확정 아키텍처는 Cognito를 전제로 하지만 현재 코드는 자체 HS256 JWT를 사용한다. `JWT_SECRET` 유출 시 관리자 세션 위조가 가능하므로 비밀 저장·회전 절차 또는 Cognito 전환이 필요하다. |
| High | 로그인 공격 방어 부족 | 로그인 및 기기 등록 API에 rate limit, 실패 지연·잠금 정책, WAF rate-based rule을 적용한다. |
| High | 보안 응답 헤더 부족 | NestJS 또는 CloudFront Response Headers Policy에서 CSP, HSTS, `X-Content-Type-Options`, frame 차단, Referrer Policy를 설정한다. |
| Medium | Swagger 운영 노출 | `/api/docs`, `/api/docs/json`을 운영에서 비활성화하거나 사내 VPN, 허용 IP 또는 별도 인증으로 제한한다. |
| Medium | 쿠키 기반 인증과 CSRF | HttpOnly/Secure/SameSite 설정만 의존하지 않고 상태 변경 API에 CSRF 토큰 또는 엄격한 Origin 검증을 적용한다. |
| Medium | EC2 관리 포트 | SSH를 인터넷에 공개하지 않고 SSM Session Manager를 사용한다. IMDSv2 강제, EBS 암호화, 최소 권한 instance profile을 적용한다. |
| Medium | 단일 EC2 장애 | 최소 2개 가용 영역과 Auto Scaling Group을 적용해 장애 및 패치 시 단일 장애점을 제거한다. |

## 3. 현재 코드 확인 결과

### 양호한 사항

- `apps/api/src/auth/auth.module.ts`에 전역 JWT 인증 가드와 권한 가드가 등록되어 있다.
- 프론트엔드는 인증 요청에 `credentials: 'include'`를 사용하며 토큰을 localStorage에 저장하지 않는다.
- 인증 쿠키에 `httpOnly`, `sameSite: 'lax'`, 운영환경 `secure`가 설정되어 있다.
- CORS origin은 명시적 목록 방식으로 구성되어 있다.
- 실제 `.env` 파일은 Git 추적 대상에서 제외되고 `.env.example`만 추적된다.

### 보완이 필요한 사항

- 현재 인증은 Cognito JWKS 검증이 아니라 `JWT_SECRET` 기반 자체 HS256 JWT이다.
- 관리자 세션 유효기간이 12시간이며 일반 관리자 세션의 서버 측 즉시 폐기 기능은 확인되지 않는다.
- Helmet/CSP, API throttling, 명시적 CSRF 방어가 확인되지 않는다.
- Swagger UI와 JSON 문서가 환경 구분 없이 활성화된다.
- `CORS_ORIGINS` 운영값을 과도하게 허용하면 쿠키 요청 가능 origin이 확대될 수 있다.
- CloudFront가 `/api/*`를 라우팅한다면 프론트엔드는 별도 EC2 주소 대신 동일 origin의 `/api`를 사용하는 것이 바람직하다.

## 4. 필수 AWS 설정 체크리스트

### 4.1 CloudFront 및 S3

- [ ] S3 Block Public Access 전체 활성화
- [ ] S3 static website endpoint 미사용
- [ ] S3 REST origin과 OAC 사용
- [ ] 버킷 정책에서 해당 CloudFront distribution ARN만 `s3:GetObject` 허용
- [ ] CloudFront Viewer Protocol Policy를 HTTP → HTTPS redirect로 설정
- [ ] TLS 1.2 이상 적용 및 ACM 인증서 사용
- [ ] `/api/*` 캐시 비활성화
- [ ] `/api/*`에 필요한 Authorization, 쿠키, 쿼리스트링만 전달
- [ ] SPA 403/404 → `/index.html` fallback은 정적 경로에만 적용하고 `/api/*`에서 제외
- [ ] 해시된 정적 파일에 장기 캐시 적용
- [ ] `index.html`에 `no-cache` 또는 짧은 캐시 적용
- [ ] CloudFront 표준 로그 또는 실시간 로그 활성화
- [ ] AWS WAF 연결 및 로그 활성화
- [ ] Response Headers Policy로 CSP, HSTS 등 적용

### 4.2 ALB 및 EC2

- [ ] ALB만 Public Subnet에 배치
- [ ] EC2는 Private Subnet에 배치하고 공인 IP 미할당
- [ ] ALB 보안그룹은 CloudFront origin-facing managed prefix list에서 오는 443만 허용
- [ ] CloudFront origin protocol policy를 HTTPS only로 설정
- [ ] CloudFront에서 ALB 인증서 hostname이 정상 검증되도록 별도 origin 도메인과 ACM 인증서 구성
- [ ] CloudFront 비밀 origin header와 ALB listener rule을 함께 적용
- [ ] 클라이언트가 보낸 동일 이름의 origin header가 신뢰되지 않도록 구성 검증
- [ ] EC2 보안그룹은 ALB 보안그룹에서 오는 애플리케이션 포트만 허용
- [ ] SSH 22 인바운드 제거 및 SSM Session Manager 사용
- [ ] IMDSv2 required 적용
- [ ] EBS 기본 암호화 및 스냅샷 암호화
- [ ] EC2 instance profile 최소 권한 적용
- [ ] 애플리케이션을 root 사용자로 실행하지 않음
- [ ] OS 및 런타임 자동 보안 패치 절차 마련
- [ ] Secrets Manager 또는 SSM Parameter Store에서 비밀값 주입
- [ ] User Data, AMI, 로그에 비밀값을 저장하지 않음
- [ ] 최소 2개 AZ 및 Auto Scaling Group 적용

### 4.3 RDS

- [ ] RDS Public Access 비활성화
- [ ] DB Subnet Group을 Private Subnet으로 구성
- [ ] RDS 보안그룹은 EC2 보안그룹에서 오는 3306만 허용
- [ ] 저장 데이터 및 자동 백업 암호화
- [ ] Multi-AZ, 자동 백업, PITR, Deletion Protection 활성화
- [ ] DB 연결 시 TLS 적용
- [ ] 애플리케이션 DB 계정에 최소 권한 적용
- [ ] 마이그레이션 계정과 런타임 계정 분리 검토

### 4.4 운영 및 탐지

- [ ] CloudTrail 활성화 및 로그 보호
- [ ] GuardDuty 활성화
- [ ] Security Hub 활성화
- [ ] AWS Config 또는 Security Hub control로 공개 S3, 공개 RDS, OAC 누락 탐지
- [ ] ALB access log 활성화
- [ ] 애플리케이션 및 시스템 로그를 CloudWatch Logs로 전송
- [ ] 5xx, 인증 실패 급증, WAF 차단, CPU·메모리·디스크, 대상 비정상 알람 구성
- [ ] IAM 사용자 대신 IAM Identity Center 및 역할 기반 접근 사용
- [ ] 루트 계정 MFA와 조직 단위 보안 통제 적용

## 5. 애플리케이션 보안 조치

- [ ] 운영환경에서 Swagger 비활성화 또는 접근 제한
- [ ] 로그인 및 공개 API rate limiting 적용
- [ ] 쿠키 인증 상태 변경 요청에 CSRF 방어 적용
- [ ] 허용 origin을 정확한 HTTPS origin 목록으로 제한
- [ ] CloudFront 동일 origin `/api/*` 사용 시 불필요한 CORS 제거 검토
- [ ] `JWT_SECRET`을 최소 256-bit 무작위 값으로 생성하고 Secrets Manager에 저장
- [ ] JWT 비밀 회전 및 기존 세션 폐기 절차 마련
- [ ] Cognito 전환 시 서명, `iss`, `client_id`, `token_use === 'access'`, 만료를 모두 검증
- [ ] 사용자 입력·오류 응답·로그에 개인정보와 인증 정보가 노출되지 않는지 점검
- [ ] 요청 body 크기, 업로드 크기, 처리 시간 제한 적용
- [ ] 프록시 신뢰 설정과 실제 클라이언트 IP 처리 검증

## 6. 배포 승인 기준

다음 조건을 모두 충족하기 전에는 운영 배포 승인을 권장하지 않는다.

1. S3가 비공개이고 OAC를 통해서만 접근 가능하다.
2. EC2에 공인 IP와 인터넷 공개 관리 포트가 없다.
3. API는 CloudFront → ALB → Private EC2 경로로만 접근 가능하다.
4. ALB에 CloudFront prefix list 제한과 비밀 origin header 검증이 모두 적용되어 있다.
5. RDS가 Private Subnet에 있으며 EC2 보안그룹만 접근 가능하다.
6. 비밀값이 Secrets Manager 또는 SSM Parameter Store에서 관리된다.
7. WAF rate-based rule과 로그인 공격 방어가 적용되어 있다.
8. 운영 Swagger가 비활성화 또는 제한되어 있다.
9. CSRF 및 보안 응답 헤더가 적용되어 있다.
10. 로그, 경보, CloudTrail, GuardDuty 등 탐지 체계가 활성화되어 있다.

## 7. 참고 자료

- AWS CloudFront, S3 origin 접근 제한: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
- AWS CloudFront, ALB origin 접근 제한: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html
- AWS CloudFront 보안 및 콘텐츠 접근 통제: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/SecurityAndPrivateContent.html
- AWS Systems Manager 보안 모범 사례: https://docs.aws.amazon.com/systems-manager/latest/userguide/security-best-practices.html

## 8. 최종 판단

`CloudFront + 비공개 S3`는 적절한 선택이다. 백엔드는 `인터넷에 직접 노출된 EC2`가 아니라 `CloudFront + ALB 뒤 Private EC2`로 구성해야 한다. 위 체크리스트와 애플리케이션 보완 사항을 적용한 뒤 실제 AWS 리소스 정책, 보안그룹, CloudFront behavior, WAF rule, IAM 정책을 별도로 검증해야 최종 보안 승인이 가능하다.
