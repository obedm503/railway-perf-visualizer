import { print } from "graphql";
import type { TadaDocumentNode } from "gql.tada";
import { log } from "evlog";
import {
  graphql,
  readFragment,
  type FragmentOf,
  type ResultOf,
  type VariablesOf,
} from "./graphql";

const RAILWAY_GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";

async function graphqlRequest<
  Result,
  Variables extends Record<string, unknown>,
>(
  accessToken: string,
  query: TadaDocumentNode<Result, Variables>,
  ...[variables]: keyof Variables extends never ? [] : [variables: Variables]
): Promise<Result> {
  const response = await fetch(RAILWAY_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: print(query),
      variables: variables ?? undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GraphQL request failed: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    data?: Result;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }

  if (!json.data) {
    throw new Error("GraphQL response missing data");
  }

  return json.data;
}

const SERVICE_INSTANCE_FRAGMENT = graphql(`
  fragment ServiceInstance on ServiceInstance {
    id
    serviceId
    serviceName
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
      activeDeployments {
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
  const data = await graphqlRequest(accessToken, SERVICE_INSTANCE_QUERY, {
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
      deploymentId
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

export function previousLogs({
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

export async function fetchHttpLogsWithVariables(
  accessToken: string,
  variables: HttpLogsVariables,
): Promise<HttpLog[]> {
  log.info({ fetchHttpLogs: { variables } });
  const data = await graphqlRequest(accessToken, HTTP_LOGS_QUERY, variables);
  return data.httpLogs;
}

const DEPLOYMENT_FRAGMENT = graphql(`
  fragment Deployment on Deployment {
    id
    createdAt
    status
  }
`);

const DEPLOYMENTS_QUERY = graphql(
  `
    query Deployments(
      $first: Int!
      $after: String
      $input: DeploymentListInput!
    ) {
      deployments(first: $first, after: $after, input: $input) {
        edges {
          node {
            ...Deployment
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [DEPLOYMENT_FRAGMENT],
);

type DeploymentSummaryMask = FragmentOf<typeof DEPLOYMENT_FRAGMENT>;

function transformDeploymentSummary(raw: DeploymentSummaryMask) {
  const deployment = readFragment(DEPLOYMENT_FRAGMENT, raw);
  return {
    id: deployment.id,
    createdAt: deployment.createdAt,
    status: deployment.status,
  };
}

export type DeploymentSummary = ReturnType<typeof transformDeploymentSummary>;

/**
 * Fetch all deployments for a service+environment created in the last 7 days.
 * Paginates through results, stopping when deployments are older than the cutoff.
 */
export async function fetchDeployments(
  accessToken: string,
  serviceId: string,
  environmentId: string,
): Promise<DeploymentSummary[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deployments: DeploymentSummary[] = [];
  let after: string | null = null;

  while (true) {
    const variables: VariablesOf<typeof DEPLOYMENTS_QUERY> = {
      first: 100,
      after,
      input: { serviceId, environmentId },
    };
    const data = await graphqlRequest(
      accessToken,
      DEPLOYMENTS_QUERY,
      variables,
    );

    const edges = data.deployments.edges;
    if (edges.length === 0) break;

    let pastCutoff = false;
    for (const edge of edges) {
      const deployment = transformDeploymentSummary(edge.node);
      if (new Date(deployment.createdAt) < cutoff) {
        pastCutoff = true;
        break;
      }
      deployments.push(deployment);
    }

    if (pastCutoff || !data.deployments.pageInfo.hasNextPage) break;
    after = data.deployments.pageInfo.endCursor ?? null;
    if (!after) break;
  }

  return deployments;
}

export async function fetchWorkspaces(
  accessToken: string,
): Promise<Workspace[]> {
  const data = await graphqlRequest(accessToken, WORKSPACES_QUERY);
  return data.me.workspaces.map(transformWorkspace);
}
