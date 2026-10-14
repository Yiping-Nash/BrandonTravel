import * as React from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { AuthLayout, AuthHeader, AuthFooter } from "@/components/layout/auth-layout";
import { Button, Input, Label } from "@/components/ui";
import { toast } from "@/hooks/use-toast";
import { useSEO, SEO_CONFIGS } from "@/hooks/useSEO";
import { getSafeRedirect } from "@/lib/auth-redirect";

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  useSEO(SEO_CONFIGS.login);
  const navigate = useNavigate();
  const redirect = React.useMemo(getSafeRedirect, []);
  const goNext = React.useCallback(() => {
    if (redirect) void navigate({ href: redirect, replace: true });
    else void navigate({ to: "/" });
  }, [navigate, redirect]);
  const { login, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = React.useState(false);
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>();

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      goNext();
    }
  }, [isAuthenticated, goNext]);

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      await login(data);
      goNext();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description:
          error instanceof Error ? error.message : "Invalid credentials",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeader
        title="登录"
        description="输入邮箱和密码"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            placeholder="邮箱地址"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            disabled={isLoading}
            {...register("email", {
              required: "请填写邮箱",
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: "邮箱格式无效",
              },
            })}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">密码</Label>

          </div>
          <Input
            id="password"
            type="password"
            placeholder="输入密码"
            autoComplete="current-password"
            disabled={isLoading}
            {...register("password", {
              required: "请填写密码",
              minLength: {
                value: 6,
                message: "密码至少6个字符",
              },
            })}
          />
          {errors.password && (
            <p className="text-sm text-destructive">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isLoading} className="w-full mt-2 h-9 text-[13px]">
          {isLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          登录
        </Button>
      </form>

      <AuthFooter>
        没有账号？{" "}
        <Link
          to="/register"
          search={redirect ? { redirect } : undefined}
          className="text-foreground hover:underline underline-offset-4"
        >
          注册
        </Link>
      </AuthFooter>
    </AuthLayout>
  );
}
