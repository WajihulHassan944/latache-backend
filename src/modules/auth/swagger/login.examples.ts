export const loginRequestExamples = {
  customer: {
    summary: 'Customer portal login',
    value: {
      email: 'customer@example.com',
      password: 'Customer@12345',
      expectedRole: 'customer',
      device: 'Chrome on Windows',
    },
  },
  tasker: {
    summary: 'Tasker portal login',
    value: {
      email: 'tasker@example.com',
      password: 'Tasker@12345',
      expectedRole: 'tasker',
      device: 'Latache Tasker iOS app',
    },
  },
  admin: {
    summary: 'Administrator portal login',
    value: {
      email: 'admin@latache.com',
      password: 'Admin@12345',
      expectedRole: 'admin',
      device: 'Admin dashboard',
    },
  },
  superAdmin: {
    summary: 'Seeded super-administrator login',
    description:
      'Development seed only. Send the displayed values as literal JSON (without Markdown links or backslash escapes) and override the password in staging and production.',
    value: {
      email: 'latache.superadmin@yopmail.com',
      password: 'Admin@12345',
      expectedRole: 'super_admin',
      device: 'Super-admin dashboard',
    },
  },
} as const;

const tokenPair = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example',
  refreshToken: 'opaque-refresh-token-example',
  tokenType: 'Bearer',
};

export const loginResponseExamples = {
  customer: {
    summary: 'Customer login response',
    value: {
      success: true,
      data: {
        user: {
          id: 12,
          firstName: 'Sarah',
          lastName: 'Ahmed',
          email: 'customer@example.com',
          phoneCountryCode: '+1',
          phoneNumber: '2025550142',
          zipCode: '10001',
          role: 'customer',
          accountStatus: 'active',
          isVerified: true,
          profilePicture: 'https://res.cloudinary.com/demo/image/upload/customer.webp',
        },
        tokens: tokenPair,
      },
      message: 'Login successful.',
    },
  },
  tasker: {
    summary: 'Tasker login response',
    value: {
      success: true,
      data: {
        user: {
          id: 18,
          firstName: 'Omar',
          lastName: 'Bennani',
          email: 'tasker@example.com',
          role: 'tasker',
          accountStatus: 'active',
          onboardingStatus: 'approved',
          yearsOfExperience: 4,
          hourlyRate: '35.00',
          isVerified: true,
          isDocVerified: true,
        },
        tokens: tokenPair,
      },
      message: 'Login successful.',
    },
  },
  admin: {
    summary: 'Administrator login response',
    value: {
      success: true,
      data: {
        user: {
          id: 20,
          adminId: 'ADM-020',
          firstName: 'Priya',
          lastName: 'Nair',
          email: 'admin@latache.com',
          role: 'admin',
          adminRole: 'finance_admin',
          permissions: ['finance.read', 'finance.manage', 'reports.read'],
          accountStatus: 'active',
          isVerified: true,
          mustChangePassword: false,
        },
        tokens: tokenPair,
      },
      message: 'Login successful.',
    },
  },
  superAdmin: {
    summary: 'Super-administrator login response',
    value: {
      success: true,
      data: {
        user: {
          id: 1,
          adminId: 'ADM-001',
          firstName: 'Latache',
          lastName: 'Super Admin',
          email: 'latache.superadmin@yopmail.com',
          role: 'super_admin',
          adminRole: 'super_admin',
          permissions: ['*'],
          accountStatus: 'active',
          isVerified: true,
          mustChangePassword: false,
        },
        tokens: tokenPair,
      },
      message: 'Login successful.',
    },
  },
} as const;
