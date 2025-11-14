import { z } from 'zod';

export const signUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
  accountType: z.enum(['singer', 'customer']),
  customerData: z
    .object({
      legalBusinessName: z.string().optional(),
      contactEmail: z.string().email().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  singerData: z
    .object({
      nickname: z.string().optional(),
    })
    .optional(),
});

export const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export const verifyEmailSchema = z.object({
  token: z.string(),
});

export const magicLinkSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const verifyMagicLinkSchema = z.object({
  token: z.string(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
