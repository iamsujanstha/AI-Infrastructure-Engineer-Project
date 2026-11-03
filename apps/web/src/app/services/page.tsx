import { ServiceDirectory } from '../../components/service-directory';

export const metadata = {
  title: 'Local services · Project Context AI',
  description: 'Links and connection details for the local development services.',
};

export default function ServicesPage() {
  return <ServiceDirectory />;
}
