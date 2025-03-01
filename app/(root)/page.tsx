import HeaderBox from '@/components/HeaderBox';
import RecentTransactions from '@/components/RecentTransactions';
import RightSidebar from '@/components/RightSidebar';
import TotalBalanceBox from '@/components/TotalBalanceBox';
import { getAccount, getAccounts } from '@/lib/actions/bank.actions';
import { getLoggedInUser } from '@/lib/actions/user.actions';

interface SearchParamProps {
  searchParams: {
    id?: string;
    page?: string;
  };
}

const Home = async ({ searchParams: { id, page } }: SearchParamProps) => {
  const currentPage = Number(page) || 1;

  // Get the logged-in user
  const loggedIn = await getLoggedInUser();
  
  // If no user is logged in, render a fallback (or redirect)
  if (!loggedIn) {
    return (
      <section className="home">
        <p>Please sign in to view your account information.</p>
      </section>
    );
  }

  // Use the logged-in user's ID safely
  const userId = loggedIn.$id;

  // Get account data for the user
  const accounts = await getAccounts({ userId });
  
  // If no accounts are found, show a message
  if (!accounts || !accounts.data || accounts.data.length === 0) {
    return (
      <section className="home">
        <p>No account information available for your user.</p>
      </section>
    );
  }
  
  const accountsData = accounts.data;
  // Use search param "id" if provided; otherwise default to the first account's appwriteItemId
  const appwriteItemId = id || accountsData[0]?.appwriteItemId;

  const account = await getAccount({ appwriteItemId });

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox 
            type="greeting"
            title="Welcome"
            user={loggedIn.firstName || 'Guest'}
            subtext="Access and manage your account and transactions efficiently."
          />

          <TotalBalanceBox 
            accounts={accountsData}
            totalBanks={accounts.totalBanks}
            totalCurrentBalance={accounts.totalCurrentBalance}
          />
        </header>

        <RecentTransactions 
          accounts={accountsData}
          transactions={account?.transactions}
          appwriteItemId={appwriteItemId}
          page={currentPage}
        />
      </div>

      <RightSidebar 
        user={loggedIn}
        transactions={account?.transactions}
        banks={accountsData.slice(0, 2)}
      />
    </section>
  );
};

export default Home;
