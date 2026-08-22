import { Helmet } from 'react-helmet-async';

const Index = () => {
  return (
    <>
      <Helmet>
        <title>Dental Pulse Enterprise</title>
        <meta name="description" content="Comprehensive practice management and financial analytics platform for multi-location dental practices." />
      </Helmet>
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
        <div className="text-center max-w-md space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Dental Pulse Enterprise
        </h1>
        <p className="text-muted-foreground">
          Ready to build your application.
        </p>
      </div>
    </div>
    </>
  );
};

export default Index;
