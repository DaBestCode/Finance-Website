"use server";

import { Client } from "dwolla-v2";

const getEnvironment = (): "production" | "sandbox" => {
  const environment = process.env.DWOLLA_ENV as string;
  switch (environment) {
    case "sandbox":
      return "sandbox";
    case "production":
      return "production";
    default:
      throw new Error(
        "Dwolla environment should either be set to `sandbox` or `production`"
      );
  }
};

const dwollaClient = new Client({
  environment: getEnvironment(),
  key: process.env.DWOLLA_KEY as string,
  secret: process.env.DWOLLA_SECRET as string,
});

// ----------------------------------------
// Interfaces
// ----------------------------------------
export interface NewDwollaCustomerParams {
  firstName: string;
  lastName: string;
  email: string;
  address1: string;
  city: string;
  postalCode: string;
  dateOfBirth: string;
  ssn: string;
  type: 'personal' | 'business';
  state?: string; // now optional
}

export interface CreateFundingSourceOptions {
  customerId: string;
  fundingSourceName: string;
  plaidToken: string;
  _links?: any; // Adjust this type as needed
}

export interface TransferParams {
  sourceFundingSourceUrl: string;
  destinationFundingSourceUrl: string;
  amount: string; // or number if preferred
}

export interface AddFundingSourceParams {
  dwollaCustomerId: string;
  processorToken: string;
  bankName: string;
}

// ----------------------------------------
// Dwolla Actions
// ----------------------------------------

// Create a Dwolla Funding Source using a Plaid Processor Token
export const createFundingSource = async (
  options: CreateFundingSourceOptions
): Promise<string | undefined> => {
  try {
    return await dwollaClient
      .post(`customers/${options.customerId}/funding-sources`, {
        name: options.fundingSourceName,
        plaidToken: options.plaidToken,
      })
      .then((res) => res.headers.get("location") || undefined);
  } catch (err) {
    console.error("Creating a Funding Source Failed: ", err);
    return undefined;
  }
};

// Create an On-Demand Authorization for Dwolla
export const createOnDemandAuthorization = async (): Promise<any> => {
  try {
    const onDemandAuthorization = await dwollaClient.post(
      "on-demand-authorizations"
    );
    const authLink = onDemandAuthorization.body._links;
    return authLink;
  } catch (err) {
    console.error("Creating an On Demand Authorization Failed: ", err);
  }
};

// Create a Dwolla Customer
export const createDwollaCustomer = async (
  newCustomer: NewDwollaCustomerParams
): Promise<string | undefined> => {
  try {
    return await dwollaClient
      .post("customers", newCustomer)
      .then((res) => res.headers.get("location") || undefined);
  } catch (err) {
    console.error("Creating a Dwolla Customer Failed: ", err);
    return undefined;
  }
};

// Create a Transfer
export const createTransfer = async ({
  sourceFundingSourceUrl,
  destinationFundingSourceUrl,
  amount,
}: TransferParams): Promise<string | undefined> => {
  try {
    const requestBody = {
      _links: {
        source: {
          href: sourceFundingSourceUrl,
        },
        destination: {
          href: destinationFundingSourceUrl,
        },
      },
      amount: {
        currency: "USD",
        value: amount,
      },
    };
    return await dwollaClient
      .post("transfers", requestBody)
      .then((res) => res.headers.get("location") || undefined);
  } catch (err) {
    console.error("Transfer fund failed: ", err);
    return undefined;
  }
};

// Add a Funding Source using a Plaid Processor Token and On-Demand Authorization
export const addFundingSource = async ({
  dwollaCustomerId,
  processorToken,
  bankName,
}: AddFundingSourceParams): Promise<string | undefined> => {
  try {
    // Create Dwolla authorization link
    const dwollaAuthLinks = await createOnDemandAuthorization();

    // Build the funding source options payload
    const fundingSourceOptions: CreateFundingSourceOptions = {
      customerId: dwollaCustomerId,
      fundingSourceName: bankName,
      plaidToken: processorToken,
      _links: dwollaAuthLinks,
    };

    return await createFundingSource(fundingSourceOptions);
  } catch (err) {
    console.error("Transfer fund failed: ", err);
    return undefined;
  }
};
