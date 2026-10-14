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

interface RegisterForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export default function RegisterPage() {
  useSEO(SEO_CONFIGS.register);
  const navigate = useNavigate();
  const redirect = React.useMemo(getSafeRedirect, []);
  const goNext = React.useCallback(() => {
    if (redirect) void navigate({ href: redirect, replace: true });
    else void navigate({ to: "/app" });
  }, [navigate, redirect]);
  const { register: registerUser, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = React.useState(false);
  
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterForm>();

  const password = watch("password");

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      goNext();
    }
  }, [isAuthenticated, goNext]);

  const onSubmit = async (data: RegisterForm) => {
    setIsLoading(true);
    try {
      await registerUser({
        name: data.name,
        email: data.email,
        password: data.password,
      });
      goNext();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Registration failed",
        description:
          error instanceof Error ? error.message : "Could not create account",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthHeader
        title="创建账号"
        description="创建本地账号，开始安排旅行"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">姓名</Label>
          <Input
            id="name"
            type="text"
            placeholder="你的名字"
            autoComplete="name"
            disabled={isLoading}
            {...register("name", {
              required: "请填写姓名",
              minLength: {
                value: 2,
                message: "姓名至少两个字符",
              },
            })}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

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
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            placeholder="设置密码（包含大小写字母和数字）"
            autoComplete="new-password"
            disabled={isLoading}
            {...register("password", {
              required: "请填写密码",
              minLength: {
                value: 8,
                message: "密码至少8个字符",
              },
            })}
          />
          {errors.password && (
            <p className="text-sm text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">确认密码</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="再次输入密码"
            autoComplete="new-password"
            disabled={isLoading}
            {...register("confirmPassword", {
              required: "请再次输入密码",
              validate: (value) =>
                value === password || "两次密码不一致",
            })}
          />
          {errors.confirmPassword && (
            <p className="text-sm text-destructive">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button type="submit" disabled={isLoading} className="w-full mt-2 h-9 text-[13px]">
          {isLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          创建账号
        </Button>
      </form>

      <AuthFooter>
        已有账号？{" "}
        <Link
          to="/login"
          search={redirect ? { redirect } : undefined}
          className="text-foreground hover:underline underline-offset-4"
        >
          登录
        </Link>
      </AuthFooter>
    </AuthLayout>
  );
}
