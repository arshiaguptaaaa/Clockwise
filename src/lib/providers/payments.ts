// Payment provider interface. MockPaymentProvider is the only
// implementation for the MVP — a real payment aggregator would implement
// the same interface without touching any call site. Never assume "group
// agreed" means a specific traveller authorised a payment — every charge
// here is tied to one explicit payerId and one explicit amount.

export type PaymentRequest = {
  payerId: string;
  amount: number;
  currency: string;
  purpose: string;
};

export type PaymentResult = {
  success: boolean;
  confirmationId: string;
};

export interface PaymentProvider {
  charge(req: PaymentRequest): Promise<PaymentResult>;
}

class MockPaymentProvider implements PaymentProvider {
  async charge(): Promise<PaymentResult> {
    return {
      success: true,
      confirmationId: `PAY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    };
  }
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
