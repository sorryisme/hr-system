import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLogin } from '@/api/generated/endpoints'
import { ApiError } from '@/api/mutator'
import logoSymbol from '@/assets/logo-symbol.png'
import logoWordmark from '@/assets/logo-wordmark.png'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setSessionUser } from '@/features/auth/session'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const login = useLogin({
    mutation: {
      onSuccess: (response) => {
        setSessionUser(response.data)
        navigate({ to: '/dashboard' })
      },
      onError: (err: unknown) => {
        // 서버가 한국어 메시지를 내려준다(INVALID_CREDENTIALS / ADMIN_ONLY / ACCOUNT_INACTIVE)
        if (err instanceof ApiError && err.status < 500) {
          setError(err.message)
          return
        }
        setError('로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.')
      },
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email || !password) {
      setError('아이디와 비밀번호를 입력해 주세요.')
      return
    }

    setError(null)
    login.mutate({ data: { email, password } })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-[380px]">
        <CardHeader className="justify-items-center gap-3 text-center">
          <img src={logoSymbol} alt="" className="size-14" />
          <img src={logoWordmark} alt="늘봄실버타운요양원" className="h-9 w-auto" />
          <CardDescription>요양원 근태관리 시스템 관리자 로그인</CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-email">아이디</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                placeholder="director@careshift.kr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-password">비밀번호</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? '로그인 중…' : '로그인'}
            </Button>
          </CardContent>
        </form>

        <CardFooter>
          <p className="text-xs text-muted-foreground">
            계정 발급 및 비밀번호 재설정은 시설 관리자에게 문의해 주세요.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
