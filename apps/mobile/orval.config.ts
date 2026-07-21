import { defineConfig } from 'orval'

// 입력은 apps/api의 openapi.json(커밋됨). mobile은 auth/devices 태그만 사용한다 —
// 근무자 도메인 API(휴가 신청 등)가 백엔드에 추가되면 태그를 확장한다. 갱신 절차:
//   pnpm --filter api openapi:export && pnpm --filter mobile generate:api
export default defineConfig({
  care: {
    input: {
      target: '../api/openapi.json',
      filters: { tags: ['auth', 'devices'] },
    },
    output: {
      target: './src/api/generated/endpoints.ts',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: {
          path: './src/api/mutator.ts',
          name: 'customFetch',
        },
      },
    },
  },
})
