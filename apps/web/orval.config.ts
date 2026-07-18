import { defineConfig } from 'orval'

// 입력은 apps/api의 openapi.json(커밋됨). 갱신 절차:
//   pnpm --filter api openapi:export && pnpm --filter web generate:api
export default defineConfig({
  care: {
    input: '../api/openapi.json',
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
