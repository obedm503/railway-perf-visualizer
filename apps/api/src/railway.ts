import { log } from "evlog";
import { GraphQLClient } from "graphql-request";
import {
  graphql,
  readFragment,
  type FragmentOf,
  type ResultOf,
  type VariablesOf,
} from "./graphql";

const RAILWAY_GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";

const SERVICE_INSTANCE_FRAGMENT = graphql(`
  fragment ServiceInstance on ServiceInstance {
    id
    serviceId
    serviceName
    latestDeployment {
      id
    }
  }
`);

const ENVIRONMENT_FRAGMENT = graphql(
  `
    fragment Environment on Environment {
      id
      name
      serviceInstances {
        edges {
          node {
            ...ServiceInstance
          }
        }
      }
    }
  `,
  [SERVICE_INSTANCE_FRAGMENT],
);

const PROJECT_FRAGMENT = graphql(
  `
    fragment Project on Project {
      id
      name
      environments {
        edges {
          node {
            ...Environment
          }
        }
      }
    }
  `,
  [ENVIRONMENT_FRAGMENT],
);

const WORKSPACE_FRAGMENT = graphql(
  `
    fragment Workspace on Workspace {
      id
      name
      projects {
        edges {
          node {
            ...Project
          }
        }
      }
    }
  `,
  [PROJECT_FRAGMENT],
);

const WORKSPACES_QUERY = graphql(
  `
    query Workspaces {
      me {
        workspaces {
          ...Workspace
        }
      }
    }
  `,
  [WORKSPACE_FRAGMENT],
);

type WorkspaceMask = FragmentOf<typeof WORKSPACE_FRAGMENT>;
type ProjectMask = FragmentOf<typeof PROJECT_FRAGMENT>;
type EnvironmentMask = FragmentOf<typeof ENVIRONMENT_FRAGMENT>;
type ServiceInstanceMask = FragmentOf<typeof SERVICE_INSTANCE_FRAGMENT>;

function flattenEdges<T>(connection: {
  edges: ReadonlyArray<{ node: T }>;
}): T[] {
  return connection.edges.map((edge) => edge.node);
}

function transformServiceInstance(raw: ServiceInstanceMask) {
  const serviceInstance = readFragment(SERVICE_INSTANCE_FRAGMENT, raw);
  return {
    id: serviceInstance.id,
    serviceId: serviceInstance.serviceId,
    serviceName: serviceInstance.serviceName,
    latestDeployment: serviceInstance.latestDeployment,
  };
}

function transformEnvironment(raw: EnvironmentMask) {
  const environment = readFragment(ENVIRONMENT_FRAGMENT, raw);
  return {
    id: environment.id,
    name: environment.name,
    serviceInstances: flattenEdges(environment.serviceInstances).map(
      transformServiceInstance,
    ),
  };
}

function transformProject(raw: ProjectMask) {
  const project = readFragment(PROJECT_FRAGMENT, raw);
  return {
    id: project.id,
    name: project.name,
    environments: flattenEdges(project.environments).map(transformEnvironment),
  };
}

function transformWorkspace(raw: WorkspaceMask) {
  const workspace = readFragment(WORKSPACE_FRAGMENT, raw);
  return {
    id: workspace.id,
    name: workspace.name,
    projects: flattenEdges(workspace.projects).map(transformProject),
  };
}

export type ServiceInstance = ReturnType<typeof transformServiceInstance>;
export type Environment = ReturnType<typeof transformEnvironment>;
export type Project = ReturnType<typeof transformProject>;
export type Workspace = ReturnType<typeof transformWorkspace>;

const SERVICE_INSTANCE_QUERY = graphql(`
  query ServiceInstance($serviceId: String!, $environmentId: String!) {
    serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
      id
      serviceName
      startCommand
      buildCommand
      rootDirectory
      healthcheckPath
      region
      numReplicas
      restartPolicyType
      restartPolicyMaxRetries
      latestDeployment {
        id
        status
        createdAt
      }
    }
  }
`);

export type ServiceInstanceDetail = ResultOf<
  typeof SERVICE_INSTANCE_QUERY
>["serviceInstance"];

export async function fetchServiceInstance(
  accessToken: string,
  serviceId: string,
  environmentId: string,
): Promise<ServiceInstanceDetail> {
  const client = new GraphQLClient(RAILWAY_GRAPHQL_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await client.request(SERVICE_INSTANCE_QUERY, {
    serviceId,
    environmentId,
  });
  return data.serviceInstance;
}

const HTTP_LOGS_QUERY = graphql(`
  query HttpLogs(
    $deploymentId: String!
    $startDate: String
    $endDate: String
    $filter: String
    $limit: Int
    $beforeLimit: Int!
    $beforeDate: String
    $anchorDate: String
    $afterDate: String
    $afterLimit: Int
  ) {
    httpLogs(
      deploymentId: $deploymentId
      startDate: $startDate
      endDate: $endDate
      filter: $filter
      limit: $limit
      beforeDate: $beforeDate
      anchorDate: $anchorDate
      afterDate: $afterDate
      beforeLimit: $beforeLimit
      afterLimit: $afterLimit
    ) {
      requestId
      timestamp
      method
      path
      host
      httpStatus
      totalDuration
      upstreamRqDuration
      edgeRegion
    }
  }
`);

export type HttpLog = ResultOf<typeof HTTP_LOGS_QUERY>["httpLogs"][number];
type HttpLogsVariables = VariablesOf<typeof HTTP_LOGS_QUERY>;

function previousLogs({
  deploymentId,
  from,
  take,
}: {
  deploymentId: string;
  from: Date;
  take: number;
}): HttpLogsVariables {
  return {
    deploymentId,
    anchorDate: from.toISOString(),
    beforeLimit: take,
  };
}

export function nextLogs({
  deploymentId,
  to,
  take,
}: {
  deploymentId: string;
  to: Date;
  take: number;
}): HttpLogsVariables {
  return {
    deploymentId,
    anchorDate: to.toISOString(),
    beforeLimit: 0,
    afterLimit: take,
  };
}

export async function fetchHttpLogs(
  accessToken: string,
  deploymentId: string,
): Promise<HttpLog[]> {
  const client = new GraphQLClient(RAILWAY_GRAPHQL_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const variables = previousLogs({
    deploymentId,
    from: new Date(),
    take: 5000,
  });
  log.info({ fetchHttpLogs: { variables } });
  const data = await client.request(HTTP_LOGS_QUERY, variables);
  return [...data.httpLogs].reverse();
}

export async function fetchWorkspaces(
  accessToken: string,
): Promise<Workspace[]> {
  const client = new GraphQLClient(RAILWAY_GRAPHQL_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await client.request(WORKSPACES_QUERY);
  return data.me.workspaces.map(transformWorkspace);
}
